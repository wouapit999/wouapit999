import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  ActionForm,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormActions,
  FormMessage,
  Input,
  LinkButton,
  PageHeader,
  SimulatedBadge,
  SubmitButton,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { getBeneficiary } from '@/server/beneficiaries';
import { isLinkedAccount } from '@/server/linked-accounts';

import { orNotFound, uuidParam } from '../../_lib/page';
import { updateBeneficiaryAction } from '../actions';

export const metadata: Metadata = { title: 'Edit beneficiary' };

/** Rename a beneficiary. The account itself is immutable: add a new beneficiary instead. */
export default async function EditBeneficiaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const id = uuidParam((await params).id);
  const beneficiary = await orNotFound(() => getBeneficiary(ctx, id));
  if (isLinkedAccount(beneficiary)) notFound();

  return (
    <>
      <PageHeader
        back={{ href: '/app/beneficiaries', label: 'Beneficiaries' }}
        title={`Edit ${beneficiary.fullName}`}
        actions={
          <LinkButton href={`/app/send?beneficiary=${beneficiary.id}`}>Send money</LinkButton>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <ActionForm action={updateBeneficiaryAction} className="space-y-4">
              <input type="hidden" name="id" value={beneficiary.id} />
              <Input
                name="fullName"
                label="Full name"
                defaultValue={beneficiary.fullName}
                required
                maxLength={120}
              />
              <Input
                name="nickname"
                label="Nickname"
                defaultValue={beneficiary.nickname ?? ''}
                maxLength={60}
              />
              <Input
                name="relationship"
                label="Relationship"
                defaultValue={beneficiary.relationship ?? ''}
                maxLength={60}
              />
              <FormMessage />
              <FormActions>
                <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
                <LinkButton href="/app/beneficiaries" variant="ghost">
                  Cancel
                </LinkButton>
              </FormActions>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Account"
            description="The account cannot be changed. To pay another account, add a new beneficiary."
          />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: 'Paid through',
                  value:
                    beneficiary.method === 'WALLET' ? (
                      'BI-Rem account'
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        {beneficiary.provider?.name ?? 'Mobile money'}
                        {beneficiary.provider?.adapter === 'simulator' ? <SimulatedBadge /> : null}
                      </span>
                    ),
                },
                { label: 'Account', value: beneficiary.accountNumber },
                { label: 'Country', value: beneficiary.country.name },
                { label: 'Currency', value: beneficiary.currency },
                { label: 'Added', value: formatDate(beneficiary.createdAt) },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
