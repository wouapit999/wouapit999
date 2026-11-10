import {
  Card,
  CardBody,
  CardHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { humanize } from '@/lib/format';
import { listRails } from '@/server/countries';

/** Registry of connectors planned beyond mobile money (phase 13). Read-only. */
export async function RailsRegistry() {
  const rails = await listRails();
  return (
    <Card>
      <CardHeader
        title="Planned rails"
        description="Card, aggregator and bank rails on the roadmap. None of them is connected in BI-Rem Lite."
      />
      {rails.length === 0 ? (
        <CardBody>
          <p className="text-sm text-fg-muted">No rail registered.</p>
        </CardBody>
      ) : (
        <Table caption="Planned rails">
          <THead>
            <Tr>
              <Th>Rail</Th>
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Notes</Th>
            </Tr>
          </THead>
          <TBody>
            {rails.map((rail) => (
              <Tr key={rail.id}>
                <Td>
                  <span className="font-medium text-fg">{rail.name}</span>
                  <p className="text-xs text-fg-subtle">{rail.code}</p>
                </Td>
                <Td>{humanize(rail.category)}</Td>
                <Td>
                  <StatusBadge status={rail.status} />
                </Td>
                <Td className="max-w-md text-fg-muted">{rail.description ?? '—'}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
