import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export interface CatalogPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  busy?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function CatalogPagination({ page, pageSize, total, busy, onPageChange, onPageSizeChange }: CatalogPaginationProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label={t('catalog.pagination', 'Catalog pagination')} className="mt-4 flex flex-wrap items-center justify-end gap-3">
      <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t('catalog.count', '{{total}} items · Page {{page}} of {{pages}}', { total, page, pages })}
      </span>
      <label className="flex items-center gap-2 text-sm">
        {t('catalog.pageSize', 'Items per page')}
        <select value={pageSize} disabled={busy} onChange={event => onPageSizeChange(Number(event.target.value))} className="rounded-md border bg-background p-2">
          {[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>{t('catalog.previous', 'Previous')}</Button>
      <Button variant="outline" disabled={busy || page >= pages} onClick={() => onPageChange(page + 1)}>{t('catalog.next', 'Next')}</Button>
    </nav>
  );
}
