import { EmptyState, LinkButton } from '@/components/ui';

/** Shown for anything in the portal that does not exist — or does not belong to this partner. */
export default function PartnerNotFound() {
  return (
    <div data-page-state="not-found">
      <EmptyState
        title="Nothing here"
        description="This page does not exist, or it belongs to another account."
        action={<LinkButton href="/partner">Back to the dashboard</LinkButton>}
      />
    </div>
  );
}
