import { ObjectId } from "mongodb";
import { getAuthConfig } from "../auth/config.js";
import { keyedHash } from "../auth/crypto.js";
import { getAuthCollections } from "../auth/database.js";
import { ApiError, assertMethod, assertSameOriginPost, errorResponse, jsonResponse, readJsonObject, requestIp } from "../auth/http.js";
import { authenticateRequest } from "../auth/service.js";
import { sendBugReportConfirmationEmail, sendFeedbackConfirmationEmail, sendHelpRequestConfirmationEmail } from "../mailer.js";
import { getSupportCollections, type SupportKind, type SupportStatus, type SupportSubmissionDocument } from "./database.js";
import { validateBugReportInput, validateFeedbackInput, validateHelpRequestInput } from "./model.js";

const SUBMIT_IP_LIMIT = 10;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_LIST_LIMIT = 100;

async function consumeRateLimit(scope: string, identifier: string, limit: number, windowMs: number): Promise<void> {
  const config = getAuthConfig();
  const { rateLimits } = await getAuthCollections();
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const id = `${scope}:${bucket}:${keyedHash(config.authSecret, `rate:${scope}`, identifier)}`;
  const bucketEnd = (bucket + 1) * windowMs;
  const result = await rateLimits.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date(now), expiresAt: new Date(bucketEnd + windowMs) } },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) throw new Error("Unable to update support rate limit.");
  if (result.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucketEnd - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Too many submissions. Try again later.", { "Retry-After": String(retryAfter) });
  }
}

async function requireAdmin(request: Request): Promise<void> {
  const user = await authenticateRequest(request);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  if (user.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access required.");
}

function toSubmissionView(document: SupportSubmissionDocument) {
  return {
    id: document._id.toHexString(),
    kind: document.kind,
    status: document.status,
    message: document.message,
    title: document.title,
    stepsToReproduce: document.stepsToReproduce,
    severity: document.severity,
    email: document.email,
    name: document.name,
    path: document.path,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export async function handleSubmitFeedback(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    await consumeRateLimit("feedback-submit", requestIp(request), SUBMIT_IP_LIMIT, SUBMIT_WINDOW_MS);
    const input = validateFeedbackInput(await readJsonObject(request));
    const { submissions } = await getSupportCollections();
    const now = new Date();
    await submissions.insertOne({
      _id: new ObjectId(),
      kind: "feedback",
      status: "new",
      message: input.message,
      title: null,
      stepsToReproduce: null,
      severity: null,
      email: input.email,
      name: input.name,
      path: input.path,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (input.email) await sendFeedbackConfirmationEmail(input.email, input.message);
    return jsonResponse({ submitted: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSubmitBugReport(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    await consumeRateLimit("bug-submit", requestIp(request), SUBMIT_IP_LIMIT, SUBMIT_WINDOW_MS);
    const input = validateBugReportInput(await readJsonObject(request));
    const { submissions } = await getSupportCollections();
    const now = new Date();
    await submissions.insertOne({
      _id: new ObjectId(),
      kind: "bug",
      status: "new",
      message: input.message,
      title: input.title,
      stepsToReproduce: input.stepsToReproduce,
      severity: input.severity,
      email: input.email,
      name: null,
      path: input.path,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (input.email) await sendBugReportConfirmationEmail(input.email, input.title, input.severity);
    return jsonResponse({ submitted: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSubmitHelpRequest(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    await consumeRateLimit("help-submit", requestIp(request), SUBMIT_IP_LIMIT, SUBMIT_WINDOW_MS);
    const input = validateHelpRequestInput(await readJsonObject(request));
    const { submissions } = await getSupportCollections();
    const now = new Date();
    await submissions.insertOne({
      _id: new ObjectId(),
      kind: "help",
      status: "new",
      message: input.message,
      title: input.subject,
      stepsToReproduce: null,
      severity: null,
      email: input.email,
      name: input.name,
      path: input.path,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      createdAt: now,
      updatedAt: now,
    });
    await sendHelpRequestConfirmationEmail(input.email, input.subject);
    return jsonResponse({ submitted: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleListSupportSubmissions(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    await requireAdmin(request);
    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    if (kindParam !== null && kindParam !== "feedback" && kindParam !== "bug" && kindParam !== "help") {
      throw new ApiError(400, "INVALID_REQUEST", "kind must be feedback, bug, or help.");
    }
    const statusParam = url.searchParams.get("status");
    if (statusParam !== null && statusParam !== "new" && statusParam !== "reviewed" && statusParam !== "resolved") {
      throw new ApiError(400, "INVALID_REQUEST", "status must be new, reviewed, or resolved.");
    }
    const filter: { kind?: SupportKind; status?: SupportStatus } = {};
    if (kindParam) filter.kind = kindParam;
    if (statusParam) filter.status = statusParam;

    const { submissions } = await getSupportCollections();
    const [documents, newCount, totalCount] = await Promise.all([
      submissions.find(filter, { sort: { createdAt: -1 }, limit: MAX_LIST_LIMIT }).toArray(),
      submissions.countDocuments({ ...filter, status: "new" }),
      submissions.countDocuments(filter),
    ]);
    return jsonResponse({ submissions: documents.map(toSubmissionView), newCount, totalCount });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleUpdateSupportStatus(request: Request, submissionId: string): Promise<Response> {
  try {
    assertMethod(request, "PATCH");
    await requireAdmin(request);
    if (!/^[a-f0-9]{24}$/.test(submissionId)) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Submission not found.");
    const body = await readJsonObject(request);
    if (Object.keys(body).some((key) => key !== "status")) {
      throw new ApiError(400, "INVALID_REQUEST", "Request contains unsupported fields.");
    }
    if (body.status !== "new" && body.status !== "reviewed" && body.status !== "resolved") {
      throw new ApiError(400, "INVALID_REQUEST", "status must be new, reviewed, or resolved.");
    }
    const { submissions } = await getSupportCollections();
    const updated = await submissions.findOneAndUpdate(
      { _id: new ObjectId(submissionId) },
      { $set: { status: body.status, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Submission not found.");
    return jsonResponse({ submission: toSubmissionView(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
