import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { Schema } from 'joi';

/** Validates and converts a request value with a Joi schema, dropping unknown keys. */
export class JoiValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: Schema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.validate(value, { abortEarly: false, stripUnknown: true });
    if (result.error) {
      throw new BadRequestException(result.error.details.map((detail) => detail.message));
    }

    return result.value;
  }
}
