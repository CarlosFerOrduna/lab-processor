import Joi from 'joi';

export class ListEventsDto {
  source?: string;
  limit: number;
  offset: number;
}

export const listEventsSchema = Joi.object<ListEventsDto>({
  source: Joi.string().max(50),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});
