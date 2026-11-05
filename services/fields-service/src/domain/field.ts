import { z } from 'zod';

export const CROPS = ['maize', 'coffee', 'rice', 'potato', 'avocado', 'banana', 'cocoa'] as const;
export const CropSchema = z.enum(CROPS);
export type Crop = z.infer<typeof CropSchema>;

const Lng = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);
const Position = z.tuple([Lng, Lat]);

/** GeoJSON Polygon (RFC 7946). Exterior ring + optional holes; each ring closed, ≥ 4 positions. */
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(
      z
        .array(Position)
        .min(4)
        .max(2000)
        .refine((ring) => {
          const [first, last] = [ring[0], ring[ring.length - 1]];
          return !!first && !!last && first[0] === last[0] && first[1] === last[1];
        }, 'Linear ring must be closed (first position equals last)'),
    )
    .min(1)
    .max(20),
});
export type Polygon = z.infer<typeof PolygonSchema>;

export const PointSchema = z.object({ type: z.literal('Point'), coordinates: Position });
export type Point = z.infer<typeof PointSchema>;

export const HealthSchema = z.enum(['healthy', 'moderate', 'stressed', 'bare']);

export const VegetationAnalysisSchema = z.object({
  vegetationCoverage: z.number(),
  stressRatio: z.number(),
  exgMean: z.number(),
  health: HealthSchema,
});
export type VegetationAnalysis = z.infer<typeof VegetationAnalysisSchema>;

export const ObservationSummarySchema = VegetationAnalysisSchema.extend({
  observationId: z.string(),
  capturedAt: z.iso.datetime(),
});
export type ObservationSummary = z.infer<typeof ObservationSummarySchema>;

export const CreateFieldSchema = z.object({
  name: z.string().trim().min(2).max(120),
  crop: CropSchema,
  geometry: PolygonSchema,
  soilPh: z.number().min(3).max(10).optional(),
  plantedAt: z.iso.date().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateFieldInput = z.infer<typeof CreateFieldSchema>;

export const UpdateFieldSchema = CreateFieldSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one property is required',
);
export type UpdateFieldInput = z.infer<typeof UpdateFieldSchema>;

export const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  crop: CropSchema,
  geometry: PolygonSchema,
  centroid: PointSchema,
  areaHa: z.number(),
  soilPh: z.number().optional(),
  plantedAt: z.string().optional(),
  notes: z.string().optional(),
  latestObservation: ObservationSummarySchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Field = z.infer<typeof FieldSchema>;

export const ObservationSchema = VegetationAnalysisSchema.extend({
  id: z.string(),
  fieldId: z.string(),
  capturedAt: z.iso.datetime(),
  imageUrl: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
});
export type Observation = z.infer<typeof ObservationSchema>;
