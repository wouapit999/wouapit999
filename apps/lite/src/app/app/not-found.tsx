import { EmptyState, LinkButton } from '@/components/ui';

/** 404 inside the customer area — also shown for objects that belong to somebody else. */
export default function CustomerNotFound() {
  return (
    <div data-page-state="not-found" className="py-8">
      <h1 className="sr-only">Not found</h1>
      <EmptyState
        title="We could not find that"
        description="It does not exist, or it is not part of your account."
        action={
          <LinkButton href="/app" variant="secondary">
            Back to home
          </LinkButton>
        }
      />
    </div>
  );
}
