export const schema = /* GraphQL */ `
  enum Crop {
    maize
    coffee
    rice
    potato
    avocado
    banana
    cocoa
  }

  enum Health {
    healthy
    moderate
    stressed
    bare
  }

  type Point {
    type: String!
    "[longitude, latitude]"
    coordinates: [Float!]!
  }

  type Polygon {
    type: String!
    "GeoJSON rings: [[[lng, lat], ...]]"
    coordinates: [[[Float!]!]!]!
  }

  type ObservationSummary {
    observationId: ID!
    capturedAt: String!
    vegetationCoverage: Float!
    stressRatio: Float!
    health: Health!
  }

  type Observation {
    id: ID!
    capturedAt: String!
    vegetationCoverage: Float!
    stressRatio: Float!
    exgMean: Float!
    health: Health!
    "Relative to the REST base path (/api)"
    imageUrl: String!
    sizeBytes: Int!
  }

  type ObservationPage {
    items: [Observation!]!
    nextCursor: String
  }

  type YieldRange {
    p10: Float!
    p50: Float!
    p90: Float!
  }

  type YieldForecast {
    "Tonnes per hectare (P10 / P50 / P90)"
    yieldTHa: YieldRange!
    "Total tonnes for the field area"
    totalT: YieldRange!
    modelVersion: String!
    "Canopy coverage used as model input (from latest image, or default)"
    vegetationCoverageUsed: Float!
  }

  type Field {
    id: ID!
    name: String!
    crop: Crop!
    geometry: Polygon!
    centroid: Point!
    areaHa: Float!
    soilPh: Float
    plantedAt: String
    notes: String
    latestObservation: ObservationSummary
    createdAt: String!
    updatedAt: String!
    observations(limit: Int = 10, cursor: String): ObservationPage!
    "Composes fields-service + ai-service: field attributes + climate scenario → yield range"
    yieldForecast(rainfallMm: Float!, avgTempC: Float!): YieldForecast!
  }

  type FieldPage {
    items: [Field!]!
    nextCursor: String
  }

  type ModelInfo {
    version: String!
    trainedAt: String!
    r2: Float
    maeTHa: Float
  }

  input PolygonInput {
    type: String! = "Polygon"
    coordinates: [[[Float!]!]!]!
  }

  input CreateFieldInput {
    name: String!
    crop: Crop!
    geometry: PolygonInput!
    soilPh: Float
    plantedAt: String
    notes: String
  }

  input UpdateFieldInput {
    name: String
    crop: Crop
    geometry: PolygonInput
    soilPh: Float
    plantedAt: String
    notes: String
  }

  type Query {
    fields(
      limit: Int = 20
      cursor: String
      crop: Crop
      "[minLng, minLat, maxLng, maxLat]"
      bbox: [Float!]
      "[lng, lat]"
      near: [Float!]
      maxDistanceKm: Float
    ): FieldPage!
    field(id: ID!): Field
    yieldModel: ModelInfo!
  }

  type Mutation {
    createField(input: CreateFieldInput!): Field!
    updateField(id: ID!, input: UpdateFieldInput!): Field!
    deleteField(id: ID!): Boolean!
  }
`;
