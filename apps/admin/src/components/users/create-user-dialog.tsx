'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { COUNTRIES, COUNTRY_CODES, SUPPORTED_LOCALES, USER_REALMS } from '@bi-rem/shared/constants';
import {
  countryCodeSchema,
  e164PhoneSchema,
  emailSchema,
  localeSchema,
  personNameSchema,
  userRealmSchema,
} from '@bi-rem/shared/schemas';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useSubmit } from '@/components/auth/use-submit';
import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
import { humanizeEnum } from '@/lib/format';
import { useCreateUser, useRoles } from '@/lib/queries';
import { PAGES } from '@/lib/routes';
import { adminCreateUserSchema } from '@/lib/schemas';

/** What the operator types; `''` means "not provided" for optional selects/inputs. */
const createUserFormSchema = z.object({
  email: emailSchema,
  realm: userRealmSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: z.union([z.literal(''), e164PhoneSchema]),
  countryCode: z.union([z.literal(''), countryCodeSchema]),
  locale: localeSchema,
  roleIds: z.array(z.string()),
  sendInvitation: z.boolean(),
});
type CreateUserFormValues = z.infer<typeof createUserFormSchema>;

const FIELDS = [
  'email',
  'realm',
  'firstName',
  'lastName',
  'phone',
  'countryCode',
  'locale',
  'roleIds',
] as const;

export function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const canReadRoles = useCan('roles:read');
  const canAssign = useCan('roles:assign');
  const roles = useRoles(open && canReadRoles);
  const create = useCreateUser();

  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: {
      email: '',
      realm: 'ADMIN',
      firstName: '',
      lastName: '',
      phone: '',
      countryCode: '',
      locale: 'en',
      roleIds: [],
      sendInvitation: true,
    },
  });
  const { run, formError, submitting } = useSubmit<CreateUserFormValues>(setError);
  const realm = useWatch({ control, name: 'realm' });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    const dto = adminCreateUserSchema.parse({
      email: values.email,
      realm: values.realm,
      firstName: values.firstName,
      lastName: values.lastName,
      locale: values.locale,
      roleIds: canAssign ? values.roleIds : [],
      sendInvitation: values.sendInvitation,
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.countryCode ? { countryCode: values.countryCode } : {}),
    });
    const user = await run(() => create.mutateAsync(dto), FIELDS);
    if (user) {
      close();
      router.push(PAGES.user(user.id));
    }
  });

  const assignableRoles = (roles.data ?? []).filter((role) =>
    realm === 'ADMIN' ? role.name !== 'CUSTOMER' : role.name === 'CUSTOMER',
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create user"
      description="An invitation with a set-password link is emailed unless you untick it."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            form="create-user-form"
            type="submit"
            loading={submitting}
            loadingLabel="Creating"
          >
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            autoComplete="off"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <TextField
            label="Last name"
            autoComplete="off"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Realm"
            hint="Administrators sign in here; customers use the customer portal."
            options={USER_REALMS.map((value) => ({ value, label: humanizeEnum(value) }))}
            error={errors.realm?.message}
            {...register('realm')}
          />
          <SelectField
            label="Locale"
            options={SUPPORTED_LOCALES.map((value) => ({ value, label: value.toUpperCase() }))}
            error={errors.locale?.message}
            {...register('locale')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Phone"
            optional
            placeholder="+237655123456"
            hint="E.164 format"
            inputMode="tel"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <SelectField
            label="Country"
            optional
            placeholder="Not set"
            options={COUNTRY_CODES.map((code) => ({ value: code, label: COUNTRIES[code].name }))}
            error={errors.countryCode?.message}
            {...register('countryCode')}
          />
        </div>
        {canAssign && canReadRoles ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">Roles</legend>
            {roles.isPending ? (
              <p className="text-xs text-fg-muted">Loading roles…</p>
            ) : assignableRoles.length === 0 ? (
              <p className="text-xs text-fg-muted">No roles available for this realm.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {assignableRoles.map((role) => (
                  <CheckboxField
                    key={role.id}
                    value={role.id}
                    label={role.name}
                    description={role.description ?? `${role.permissions.length} permissions`}
                    {...register('roleIds')}
                  />
                ))}
              </div>
            )}
            {errors.roleIds?.message ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {errors.roleIds.message}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <CheckboxField
          label="Send invitation email"
          description="Lets the person set their own password. Untick only for service or test accounts."
          {...register('sendInvitation')}
        />
      </form>
    </Dialog>
  );
}
