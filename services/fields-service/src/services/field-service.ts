import type { AiClient } from '../clients/ai-client.js';
import { DomainError } from '../domain/errors.js';
import type { CreateFieldInput, Field, Observation, UpdateFieldInput } from '../domain/field.js';
import { deriveGeometry } from '../domain/geo.js';
import type {
  FieldRepository,
  ListFieldsQuery,
  NewImage,
  ObservationRepository,
  Page,
  StoredImage,
} from '../repositories/types.js';

/** Application service: orchestrates domain rules, persistence and the AI service. */
export class FieldService {
  constructor(
    private readonly fields: FieldRepository,
    private readonly observations: ObservationRepository,
    private readonly ai: AiClient,
  ) {}

  list(query: ListFieldsQuery): Promise<Page<Field>> {
    return this.fields.list(query);
  }

  async get(tenantId: string, id: string): Promise<Field> {
    const field = await this.fields.get(tenantId, id);
    if (!field) throw new DomainError('NOT_FOUND', `Field ${id} not found`);
    return field;
  }

  create(tenantId: string, input: CreateFieldInput): Promise<Field> {
    return this.fields.create(tenantId, { ...input, ...deriveGeometry(input.geometry) });
  }

  async update(tenantId: string, id: string, input: UpdateFieldInput): Promise<Field> {
    const patch = input.geometry ? { ...input, ...deriveGeometry(input.geometry) } : input;
    const field = await this.fields.update(tenantId, id, patch);
    if (!field) throw new DomainError('NOT_FOUND', `Field ${id} not found`);
    return field;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.fields.delete(tenantId, id);
    if (!deleted) throw new DomainError('NOT_FOUND', `Field ${id} not found`);
    await this.observations.deleteByField(tenantId, id);
  }

  async addObservation(
    tenantId: string,
    fieldId: string,
    image: NewImage,
    requestId?: string,
  ): Promise<Observation> {
    await this.get(tenantId, fieldId); // 404 before spending compute on analysis
    const analysis = await this.ai.analyzeVegetation(image.buffer, image.contentType, requestId);
    const obs = await this.observations.create(tenantId, fieldId, analysis, image);
    await this.fields.setLatestObservation(tenantId, fieldId, {
      observationId: obs.id,
      capturedAt: obs.capturedAt,
      vegetationCoverage: obs.vegetationCoverage,
      stressRatio: obs.stressRatio,
      exgMean: obs.exgMean,
      health: obs.health,
    });
    return obs;
  }

  async listObservations(tenantId: string, fieldId: string, limit: number, cursor?: string) {
    await this.get(tenantId, fieldId);
    return this.observations.listByField(tenantId, fieldId, limit, cursor);
  }

  async openImage(tenantId: string, observationId: string): Promise<StoredImage> {
    const img = await this.observations.openImage(tenantId, observationId);
    if (!img) throw new DomainError('NOT_FOUND', `Observation ${observationId} not found`);
    return img;
  }
}
