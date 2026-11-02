import Joi from 'joi';

export class CreateEventDto {
  id: string;
  source: string;
  type: string;
  occurredAt: Date;
  payload: object;
}

export const createEventSchema = Joi.object<CreateEventDto>({
  id: Joi.string().uuid().required(),
  source: Joi.string().max(50).required(),
  type: Joi.string().max(100).required(),
  occurredAt: Joi.date().iso().required(),
  payload: Joi.object().required(),
});
