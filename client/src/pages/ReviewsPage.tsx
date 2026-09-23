import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * The review queue: versions of tests waiting to be published.
 *
 * A reviewer decides from here without opening each test — which test, which version, what
 * changed, who asked and why. Approving publishes; rejecting needs a reason, because "rejected"
 * alone sends the author back with nothing to fix. Nobody can decide on their own change.
 */

interface ReviewRow {
  id: number;
  testId: number;
  testName: string;
  version: number;
  publishedVersion: number | null;
  summary: string | null;
  note: string | null;
  requestedByName: string | null;
  requestedAt: string;
  canDecide: boolean;
}

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload;
}

function ReviewItem({ review, onDecided }: { review: ReviewRow; onDecided: () => void }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !comment.trim()) {
      setError(t('reviews.reasonRequired', 'Say what needs to change before rejecting.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post(`/api/test-reviews/${review.id}/${decision}`, { comment: comment.trim() || undefined });
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border rounded-md p-3 space-y-2" data-testid={`review-${review.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{review.testName}</span>
        <Badge variant="outline">{t('reviews.version', 'version {{n}}', { n: review.version })}</Badge>
        {review.publishedVersion !== null && (
          <span className="text-xs text-muted-foreground">
            {t('reviews.replaces', 'replaces version {{n}}', { n: review.publishedVersion })}
          </span>
        )}
      </div>
      {review.summary && <p className="text-sm">{review.summary}</p>}
      {review.note && <p className="text-sm italic text-muted-foreground">“{review.note}”</p>}
      <p className="text-xs text-muted-foreground">
        {t('reviews.askedBy', 'Asked by {{name}} on {{date}}', {
          name: review.requestedByName ?? t('reviews.formerMember', 'a former member'),
          date: new Date(review.requestedAt).toLocaleString(),
        })}
      </p>
      {review.canDecide ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('reviews.commentPlaceholder', 'Comment (needed to reject)')}
            aria-label={t('reviews.commentLabel', 'Comment on {{name}}', { name: review.testName })}
          />
          <Button size="sm" disabled={busy} onClick={() => decide('approve')}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            {t('reviews.approve', 'Approve and publish')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('reject')}>
            <X className="h-4 w-4 mr-1" />
            {t('reviews.reject', 'Reject')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('reviews.notYours', 'Someone other than its author has to decide on this change.')}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

export default function ReviewsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [policyError, setPolicyError] = useState('');

  const { data: reviews = [], isLoading, isError } = useQuery<ReviewRow[]>({
    queryKey: ['testReviews'],
    queryFn: async () => {
      const response = await fetch('/api/test-reviews', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the reviews');
      return response.json();
    },
  });
  const { data: policy } = useQuery<{ required: boolean }>({
    queryKey: ['testReviewPolicy'],
    queryFn: async () => {
      const response = await fetch('/api/organization/test-review-policy', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the policy');
      return response.json();
    },
  });

  const setPolicy = async (required: boolean) => {
    setPolicyError('');
    const response = await fetch('/api/organization/test-review-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ required }),
    });
    if (!response.ok) setPolicyError(t('reviews.policyError', 'Could not change the policy.'));
    queryClient.invalidateQueries({ queryKey: ['testReviewPolicy'] });
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            {t('reviews.title', 'Test reviews')}
          </CardTitle>
          <CardDescription>
            {t(
              'reviews.description',
              'A saved test is a working copy. Plans run the published version. Approving a review here publishes that version.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.role === 'owner' && policy && (
            <div className="flex items-start justify-between gap-4 border-b pb-4">
              <div>
                <Label htmlFor="review-policy" className="text-sm font-medium">
                  {t('reviews.policyLabel', 'Require a review to publish')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'reviews.policyHint',
                    'Publishing then needs another member’s approval, and plans skip tests that have never been published. Rolling back to a version that was live before stays possible.',
                  )}
                </p>
              </div>
              <Switch id="review-policy" checked={policy.required} onCheckedChange={setPolicy} />
            </div>
          )}
          {policyError && <p className="text-sm text-destructive">{policyError}</p>}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('reviews.loading', 'Loading…')}</p>
          ) : isError ? (
            <p className="text-sm text-destructive">{t('reviews.error', 'The reviews could not be loaded.')}</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reviews.empty', 'Nothing is waiting for review.')}</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((review) => (
                <ReviewItem key={review.id} review={review} onDecided={() => queryClient.invalidateQueries({ queryKey: ['testReviews'] })} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
