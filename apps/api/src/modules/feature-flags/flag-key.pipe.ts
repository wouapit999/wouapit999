import { Injectable, type PipeTransform } from '@nestjs/common';
import { FEATURE_FLAG_KEY_PATTERN, SETTING_KEY_PATTERN } from '@bi-rem/shared';

import { ApiException } from '../../common/errors/api-exception.js';

/** Validates `area.feature[.variant]` keys used by feature flags and settings. */
@Injectable()
export class FlagKeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const key = value.trim();
    if (
      key.length > 100 ||
      !(FEATURE_FLAG_KEY_PATTERN.test(key) || SETTING_KEY_PATTERN.test(key))
    ) {
      throw ApiException.badRequest(
        'Invalid key: expected lowercase dotted segments such as area.feature',
      );
    }
    return key;
  }
}
