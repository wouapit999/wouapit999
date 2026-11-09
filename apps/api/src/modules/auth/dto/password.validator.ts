import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { strongPasswordSchema } from '@bi-rem/shared';

/** Applies the shared Zod password policy (12–128 chars, mixed case, digit, symbol). */
export function IsStrongPasswordPolicy(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isStrongPasswordPolicy',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && strongPasswordSchema.safeParse(value).success;
        },
        defaultMessage(args: ValidationArguments): string {
          const result = strongPasswordSchema.safeParse(args.value);
          if (result.success) return 'Password does not meet the policy';
          return result.error.issues.map((issue) => issue.message).join('; ');
        },
      },
    });
  };
}
