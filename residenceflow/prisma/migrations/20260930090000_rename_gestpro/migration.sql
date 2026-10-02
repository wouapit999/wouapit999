-- Application renamed to GestPro: new default and rename organizations still using the old default name.
ALTER TABLE "OrganizationSettings" ALTER COLUMN "appName" SET DEFAULT 'GestPro';
UPDATE "OrganizationSettings" SET "appName" = 'GestPro' WHERE "appName" = 'ResidenceFlow';
