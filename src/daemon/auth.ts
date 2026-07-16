import {
  createHash,
  createHmac,
  timingSafeEqual,
  type BinaryLike,
} from "node:crypto";
import type { IncomingMessage } from "node:http";

export type CredentialRecord = {
  id: string;
  accessKeyId: string;
  secretAccessKey: string;
  createdAt: string;
  name: string;
  readOnly?: boolean;
  bucket?: string;
};

export type AuthenticationResult =
  | { ok: true; credential?: CredentialRecord }
  | { ok: false; code: string; message: string; status: number };

export const AWS_V4_ALGORITHM = "AWS4-HMAC-SHA256";
export const AWS_V4_TERMINATOR = "aws4_request";
export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
export const MAX_PRESIGNED_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const HEADER_CLOCK_SKEW_MILLISECONDS = 15 * 60 * 1_000;

const HEX_SHA256 = /^[a-fA-F0-9]{64}$/;
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const SIGNED_HEADER_NAME = /^[a-z0-9-]+$/;
const PRESIGN_FIELDS = [
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-SignedHeaders",
  "X-Amz-Signature",
] as const;

type ParsedCredentialScope = {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  terminal: string;
  value: string;
};

type ParsedSignedHeaders = {
  names: string[];
  value: string;
};

function failure(
  code: string,
  message: string,
  status = 403,
): AuthenticationResult {
  return { ok: false, code, message, status };
}

/** SHA-256 as lowercase hexadecimal, useful to clients constructing SigV4 requests. */
export function sha256Hex(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}

/** AWS percent encoding (RFC 3986 unreserved characters only). */
export function awsPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Produces the S3 canonical URI. Slash boundaries and repeated slashes are kept;
 * each segment is decoded once and then encoded with the AWS rules.
 */
export function canonicalizePath(pathname: string): string {
  const path = pathname.length === 0 ? "/" : pathname.startsWith("/") ? pathname : `/${pathname}`;
  return path
    .split("/")
    .map((segment) => awsPercentEncode(decodeURIComponent(segment)))
    .join("/");
}

/** Canonicalizes all query pairs, retaining duplicates and empty values. */
export function canonicalizeQuery(
  url: URL,
  excludedNames: ReadonlySet<string> = new Set(["X-Amz-Signature"]),
): string {
  const pairs: Array<[string, string]> = [];

  for (const [name, value] of url.searchParams) {
    if (!excludedNames.has(name)) {
      pairs.push([awsPercentEncode(name), awsPercentEncode(value)]);
    }
  }

  pairs.sort(([leftName, leftValue], [rightName, rightValue]) => {
    if (leftName !== rightName) {
      return leftName < rightName ? -1 : 1;
    }
    if (leftValue === rightValue) {
      return 0;
    }
    return leftValue < rightValue ? -1 : 1;
  });

  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

function requestHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return value;
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/[\t\n\r ]+/g, " ");
}

function parseSignedHeaders(value: string): ParsedSignedHeaders | undefined {
  if (value.length === 0 || value !== value.toLowerCase()) {
    return undefined;
  }

  const names = value.split(";");
  if (
    names.some((name) => !SIGNED_HEADER_NAME.test(name)) ||
    new Set(names).size !== names.length
  ) {
    return undefined;
  }

  const sorted = [...names].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  if (sorted.join(";") !== value || !names.includes("host")) {
    return undefined;
  }

  return { names, value };
}

/**
 * Builds the canonical header block for an already validated SignedHeaders list.
 * It throws when a named request header is absent.
 */
export function canonicalizeHeaders(
  req: IncomingMessage,
  signedHeaderNames: readonly string[],
): string {
  return signedHeaderNames
    .map((name) => {
      const value = requestHeader(req, name);
      if (value === undefined) {
        throw new Error(`Signed header is missing: ${name}`);
      }
      return `${name}:${normalizeHeaderValue(value)}\n`;
    })
    .join("");
}

/** Constructs the six-line AWS canonical request representation. */
export function createCanonicalRequest(
  method: string,
  url: URL,
  canonicalHeaders: string,
  signedHeaders: string,
  payloadHash: string,
): string {
  return [
    method.toUpperCase(),
    canonicalizePath(url.pathname),
    canonicalizeQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
}

/** Derives the AWS4 signing key for a credential scope. */
export function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service = "s3",
): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(date).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update(service).digest();
  return createHmac("sha256", serviceKey).update(AWS_V4_TERMINATOR).digest();
}

/** Signs a complete SigV4 string-to-sign and returns lowercase hexadecimal. */
export function signV4String(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
  stringToSign: string,
): string {
  return createHmac(
    "sha256",
    deriveSigningKey(secretAccessKey, date, region, service),
  )
    .update(stringToSign)
    .digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!HEX_SHA256.test(left) || !HEX_SHA256.test(right)) {
    return false;
  }
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseCredentialScope(value: string): ParsedCredentialScope | undefined {
  const parts = value.split("/");
  if (parts.length !== 5) {
    return undefined;
  }

  const [accessKeyId, date, region, service, terminal] = parts;
  if (
    !accessKeyId ||
    !/^\d{8}$/.test(date) ||
    !region ||
    !/^[a-z0-9-]+$/.test(region) ||
    service !== "s3" ||
    terminal !== AWS_V4_TERMINATOR
  ) {
    return undefined;
  }

  return { accessKeyId, date, region, service, terminal, value };
}

function parseAmzDate(value: string): Date | undefined {
  const match = AMZ_DATE.exec(value);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  return formatAmzDate(parsed) === value ? parsed : undefined;
}

export function formatAmzDate(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, "0");
  const month = (value.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = value.getUTCDate().toString().padStart(2, "0");
  const hour = value.getUTCHours().toString().padStart(2, "0");
  const minute = value.getUTCMinutes().toString().padStart(2, "0");
  const second = value.getUTCSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function validateScopeAndCredential(
  scope: ParsedCredentialScope | undefined,
  amzDate: string,
  credentials: CredentialRecord[],
): AuthenticationResult | CredentialRecord {
  if (!scope) {
    return failure(
      "AuthorizationHeaderMalformed",
      "The credential scope is malformed or does not target the S3 service.",
      400,
    );
  }
  if (scope.date !== amzDate.slice(0, 8)) {
    return failure(
      "AuthorizationHeaderMalformed",
      "The credential scope date does not match the request date.",
      400,
    );
  }

  const credential = credentials.find(
    (candidate) => candidate.accessKeyId === scope.accessKeyId,
  );
  if (!credential) {
    return failure(
      "InvalidAccessKeyId",
      "The AWS access key ID you provided does not exist.",
    );
  }
  return credential;
}

function validatePayloadHash(
  req: IncomingMessage,
  url: URL,
  presigned: boolean,
): AuthenticationResult | string {
  const headerHash = requestHeader(req, "x-amz-content-sha256")?.trim();
  const queryHashes = url.searchParams.getAll("X-Amz-Content-Sha256");
  if (queryHashes.length > 1) {
    return failure(
      "InvalidRequest",
      "X-Amz-Content-Sha256 may only be provided once.",
      400,
    );
  }

  const payloadHash =
    headerHash ?? queryHashes[0] ?? (presigned ? "UNSIGNED-PAYLOAD" : EMPTY_SHA256);
  if (payloadHash !== "UNSIGNED-PAYLOAD" && !HEX_SHA256.test(payloadHash)) {
    return failure(
      "InvalidRequest",
      "The request payload hash must be a SHA-256 value or UNSIGNED-PAYLOAD.",
      400,
    );
  }
  return payloadHash;
}

function validateSignedHeaders(
  req: IncomingMessage,
  rawSignedHeaders: string,
  requireDateHeader: boolean,
): AuthenticationResult | ParsedSignedHeaders {
  const signedHeaders = parseSignedHeaders(rawSignedHeaders);
  if (!signedHeaders) {
    return failure(
      "AuthorizationHeaderMalformed",
      "SignedHeaders must be a sorted, lowercase list that includes host.",
      400,
    );
  }
  if (requireDateHeader && !signedHeaders.names.includes("x-amz-date")) {
    return failure(
      "AuthorizationHeaderMalformed",
      "The x-amz-date header must be signed.",
      400,
    );
  }

  // An unsigned x-amz-* operation header would permit its meaning to be changed
  // after signing. The payload hash is already protected by the canonical request.
  for (const headerName of Object.keys(req.headers)) {
    if (
      headerName.startsWith("x-amz-") &&
      headerName !== "x-amz-content-sha256" &&
      !signedHeaders.names.includes(headerName)
    ) {
      return failure(
        "UnsignedHeaders",
        `The ${headerName} header must be included in SignedHeaders.`,
        400,
      );
    }
  }

  try {
    canonicalizeHeaders(req, signedHeaders.names);
  } catch (error) {
    const message = error instanceof Error ? error.message : "A signed header is missing.";
    return failure("AuthorizationHeaderMalformed", message, 400);
  }
  return signedHeaders;
}

function calculateExpectedSignature(
  req: IncomingMessage,
  url: URL,
  credential: CredentialRecord,
  scope: ParsedCredentialScope,
  signedHeaders: ParsedSignedHeaders,
  amzDate: string,
  payloadHash: string,
): string | AuthenticationResult {
  let canonicalHeaders: string;
  let canonicalRequest: string;
  try {
    canonicalHeaders = canonicalizeHeaders(req, signedHeaders.names);
    canonicalRequest = createCanonicalRequest(
      req.method ?? "GET",
      url,
      canonicalHeaders,
      signedHeaders.value,
      payloadHash,
    );
  } catch (error) {
    const message = error instanceof URIError
      ? "The request URI contains invalid percent encoding."
      : error instanceof Error
        ? error.message
        : "The canonical request could not be created.";
    return failure("InvalidURI", message, 400);
  }

  const stringToSign = [
    AWS_V4_ALGORITHM,
    amzDate,
    `${scope.date}/${scope.region}/${scope.service}/${scope.terminal}`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  return signV4String(
    credential.secretAccessKey,
    scope.date,
    scope.region,
    scope.service,
    stringToSign,
  );
}

function parseAuthorizationHeader(value: string):
  | AuthenticationResult
  | { credential: string; signedHeaders: string; signature: string } {
  const prefix = `${AWS_V4_ALGORITHM} `;
  if (!value.startsWith(prefix)) {
    return failure(
      "AuthorizationHeaderMalformed",
      `Authorization must use ${AWS_V4_ALGORITHM}.`,
      400,
    );
  }

  const attributes = new Map<string, string>();
  for (const component of value.slice(prefix.length).split(",")) {
    const equals = component.indexOf("=");
    if (equals < 1) {
      return failure("AuthorizationHeaderMalformed", "Authorization is malformed.", 400);
    }
    const name = component.slice(0, equals).trim();
    const attributeValue = component.slice(equals + 1).trim();
    if (
      !["Credential", "SignedHeaders", "Signature"].includes(name) ||
      attributes.has(name) ||
      attributeValue.length === 0
    ) {
      return failure("AuthorizationHeaderMalformed", "Authorization is malformed.", 400);
    }
    attributes.set(name, attributeValue);
  }

  const credential = attributes.get("Credential");
  const signedHeaders = attributes.get("SignedHeaders");
  const signature = attributes.get("Signature");
  if (!credential || !signedHeaders || !signature || !HEX_SHA256.test(signature)) {
    return failure(
      "AuthorizationHeaderMalformed",
      "Authorization requires Credential, SignedHeaders, and a SHA-256 Signature.",
      400,
    );
  }
  return { credential, signedHeaders, signature };
}

function verifyHeaderAuthentication(
  req: IncomingMessage,
  url: URL,
  credentials: CredentialRecord[],
  authorization: string,
  now: Date,
): AuthenticationResult {
  const parsedAuthorization = parseAuthorizationHeader(authorization);
  if ("ok" in parsedAuthorization) {
    return parsedAuthorization;
  }

  const amzDate = requestHeader(req, "x-amz-date")?.trim();
  const requestDate = amzDate ? parseAmzDate(amzDate) : undefined;
  if (!amzDate || !requestDate) {
    return failure(
      "AuthorizationHeaderMalformed",
      "A valid x-amz-date header is required.",
      400,
    );
  }
  if (Math.abs(now.getTime() - requestDate.getTime()) > HEADER_CLOCK_SKEW_MILLISECONDS) {
    return failure(
      "RequestTimeTooSkewed",
      "The difference between the request time and the server time is too large.",
    );
  }

  const scope = parseCredentialScope(parsedAuthorization.credential);
  const credentialResult = validateScopeAndCredential(scope, amzDate, credentials);
  if ("ok" in credentialResult) {
    return credentialResult;
  }
  const credential = credentialResult;

  const signedHeadersResult = validateSignedHeaders(
    req,
    parsedAuthorization.signedHeaders,
    true,
  );
  if ("ok" in signedHeadersResult) {
    return signedHeadersResult;
  }

  const payloadHashResult = validatePayloadHash(req, url, false);
  if (typeof payloadHashResult !== "string") {
    return payloadHashResult;
  }

  // The scope was checked by validateScopeAndCredential above.
  if (!scope) {
    return failure("AuthorizationHeaderMalformed", "Credential scope is malformed.", 400);
  }
  const expectedSignature = calculateExpectedSignature(
    req,
    url,
    credential,
    scope,
    signedHeadersResult,
    amzDate,
    payloadHashResult,
  );
  if (typeof expectedSignature !== "string") {
    return expectedSignature;
  }
  if (!safeEqualHex(expectedSignature, parsedAuthorization.signature)) {
    return failure(
      "SignatureDoesNotMatch",
      "The request signature we calculated does not match the signature you provided.",
    );
  }
  return { ok: true, credential };
}

function singlePresignField(url: URL, name: string): AuthenticationResult | string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || values[0].length === 0) {
    return failure(
      "AuthorizationQueryParametersError",
      `${name} must be provided exactly once.`,
      400,
    );
  }
  return values[0];
}

function verifyPresignedAuthentication(
  req: IncomingMessage,
  url: URL,
  credentials: CredentialRecord[],
  now: Date,
): AuthenticationResult {
  const values = new Map<string, string>();
  for (const field of PRESIGN_FIELDS) {
    const result = singlePresignField(url, field);
    if (typeof result !== "string") {
      return result;
    }
    values.set(field, result);
  }

  const algorithm = values.get("X-Amz-Algorithm");
  const credentialValue = values.get("X-Amz-Credential");
  const amzDate = values.get("X-Amz-Date");
  const expiresValue = values.get("X-Amz-Expires");
  const signedHeaderValue = values.get("X-Amz-SignedHeaders");
  const providedSignature = values.get("X-Amz-Signature");
  if (
    algorithm !== AWS_V4_ALGORITHM ||
    !credentialValue ||
    !amzDate ||
    !expiresValue ||
    !signedHeaderValue ||
    !providedSignature
  ) {
    return failure(
      "AuthorizationQueryParametersError",
      "The presigned authentication parameters are invalid.",
      400,
    );
  }
  if (!HEX_SHA256.test(providedSignature)) {
    return failure(
      "AuthorizationQueryParametersError",
      "X-Amz-Signature must be a SHA-256 signature.",
      400,
    );
  }

  const requestDate = parseAmzDate(amzDate);
  if (!requestDate) {
    return failure(
      "AuthorizationQueryParametersError",
      "X-Amz-Date is invalid.",
      400,
    );
  }
  if (!/^[1-9]\d*$/.test(expiresValue)) {
    return failure(
      "AuthorizationQueryParametersError",
      "X-Amz-Expires must be a positive integer.",
      400,
    );
  }
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires > MAX_PRESIGNED_EXPIRY_SECONDS) {
    return failure(
      "AuthorizationQueryParametersError",
      "X-Amz-Expires must not exceed seven days.",
      400,
    );
  }
  if (requestDate.getTime() - now.getTime() > HEADER_CLOCK_SKEW_MILLISECONDS) {
    return failure(
      "RequestTimeTooSkewed",
      "The presigned request date is too far in the future.",
    );
  }
  if (now.getTime() > requestDate.getTime() + expires * 1_000) {
    return failure("AccessDenied", "The presigned request has expired.");
  }

  const scope = parseCredentialScope(credentialValue);
  const credentialResult = validateScopeAndCredential(scope, amzDate, credentials);
  if ("ok" in credentialResult) {
    return credentialResult;
  }
  const credential = credentialResult;

  const signedHeadersResult = validateSignedHeaders(req, signedHeaderValue, false);
  if ("ok" in signedHeadersResult) {
    return signedHeadersResult;
  }
  const payloadHashResult = validatePayloadHash(req, url, true);
  if (typeof payloadHashResult !== "string") {
    return payloadHashResult;
  }

  if (!scope) {
    return failure("AuthorizationQueryParametersError", "Credential scope is malformed.", 400);
  }
  const expectedSignature = calculateExpectedSignature(
    req,
    url,
    credential,
    scope,
    signedHeadersResult,
    amzDate,
    payloadHashResult,
  );
  if (typeof expectedSignature !== "string") {
    return expectedSignature;
  }
  if (!safeEqualHex(expectedSignature, providedSignature)) {
    return failure(
      "SignatureDoesNotMatch",
      "The request signature we calculated does not match the signature you provided.",
    );
  }
  return { ok: true, credential };
}

/**
 * Verifies S3-compatible AWS Signature V4 header or presigned-query
 * authentication. It does not consume the request stream: a SHA-256 payload
 * hash is treated as the signed declaration and should also be enforced while
 * the daemon persists the body.
 */
export async function verifyS3Authentication(
  req: IncomingMessage,
  url: URL,
  credentials: CredentialRecord[],
  allowAnonymous: boolean,
  now: Date = new Date(),
): Promise<AuthenticationResult> {
  const authorization = requestHeader(req, "authorization");
  const lowerPresignFields = new Set(PRESIGN_FIELDS.map((field) => field.toLowerCase()));
  const hasPresignAttempt = [...url.searchParams.keys()].some((name) =>
    lowerPresignFields.has(name.toLowerCase()),
  );

  if (!Number.isFinite(now.getTime())) {
    return failure("InvalidRequest", "The server time is invalid.", 500);
  }
  if (authorization !== undefined && hasPresignAttempt) {
    return failure(
      "InvalidRequest",
      "Use either an Authorization header or presigned query parameters, not both.",
      400,
    );
  }
  if (authorization !== undefined) {
    return verifyHeaderAuthentication(req, url, credentials, authorization.trim(), now);
  }
  if (hasPresignAttempt) {
    return verifyPresignedAuthentication(req, url, credentials, now);
  }
  if (allowAnonymous) {
    return { ok: true };
  }
  return failure("AccessDenied", "Authentication is required.");
}

function validateShareExpiry(expires: number): void {
  if (!Number.isSafeInteger(expires) || expires < 0) {
    throw new RangeError("Share token expiry must be a non-negative Unix timestamp.");
  }
}

function shareTokenPayload(bucket: string, key: string, expires: number): string {
  return JSON.stringify([bucket, key, expires]);
}

/** Creates an unpadded base64url HMAC token bound to one object and expiry. */
export function createShareToken(
  secret: string,
  bucket: string,
  key: string,
  expires: number,
): string {
  validateShareExpiry(expires);
  return createHmac("sha256", secret)
    .update(shareTokenPayload(bucket, key, expires))
    .digest("base64url");
}

/** Verifies the share HMAC in constant time and rejects expired links. */
export function verifyShareToken(
  secret: string,
  bucket: string,
  key: string,
  expires: number,
  token: string,
): boolean {
  try {
    validateShareExpiry(expires);
  } catch {
    return false;
  }
  if (Date.now() > expires * 1_000 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }

  // Compare the canonical text, not merely the decoded bytes. Base64url can
  // otherwise admit alternate final characters whose unused bits decode to
  // the same HMAC, making a visibly modified bearer token still validate.
  const expected = Buffer.from(createShareToken(secret, bucket, key, expires), "ascii");
  const provided = Buffer.from(token, "ascii");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
