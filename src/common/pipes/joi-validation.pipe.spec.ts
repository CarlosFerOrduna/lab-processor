import { BadRequestException } from '@nestjs/common';
import Joi from 'joi';
import { JoiValidationPipe } from './joi-validation.pipe';

describe('JoiValidationPipe', () => {
  const pipe = new JoiValidationPipe(
    Joi.object<{ name: string; limit: number }>({
      name: Joi.string().required(),
      limit: Joi.number().default(20),
    }),
  );

  it('returns the converted value with defaults and without unknown keys', () => {
    expect(pipe.transform({ name: 'item', extra: true })).toEqual({ name: 'item', limit: 20 });
  });

  it('rejects an invalid value with every validation message', () => {
    expect(() => pipe.transform({ limit: 'many' })).toThrow(BadRequestException);
  });
});
