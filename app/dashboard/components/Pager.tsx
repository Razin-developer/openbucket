import { useMemo, useState } from "react";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious,
} from "../../components/ui/pagination";

const PAGE_SIZE = 25;

/** Client-side pager — the daemon's list endpoints don't support server-side paging yet. */
export function usePager<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [items, clampedPage],
  );
  return { page: clampedPage, pageCount, pageItems, setPage };
}

export function ListPagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <Pagination className="ob-pagination">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" aria-disabled={page === 1} className={page === 1 ? "pointer-events-none opacity-50" : undefined} onClick={(event) => { event.preventDefault(); onChange(Math.max(1, page - 1)); }} />
        </PaginationItem>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <PaginationItem key={number}>
            <PaginationLink href="#" isActive={number === page} onClick={(event) => { event.preventDefault(); onChange(number); }}>{number}</PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext href="#" aria-disabled={page === pageCount} className={page === pageCount ? "pointer-events-none opacity-50" : undefined} onClick={(event) => { event.preventDefault(); onChange(Math.min(pageCount, page + 1)); }} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
