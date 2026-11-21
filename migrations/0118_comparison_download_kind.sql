-- A known difference may name the download checkpoints (checkpointDownload) a comparison now diffs.
ALTER TABLE comparison_known_differences DROP CONSTRAINT comparison_known_differences_kind_check;
--> statement-breakpoint
ALTER TABLE comparison_known_differences ADD CONSTRAINT comparison_known_differences_kind_check CHECK (kind IN (
  'outcome', 'text', 'table', 'chart', 'network', 'download', 'visual', 'performance'
));
