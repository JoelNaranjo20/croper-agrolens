import type { IResolvers, MercuriusContext } from 'mercurius';
import mercurius from 'mercurius';
import type { CallContext } from '../clients/http.js';
import { UpstreamError } from '../clients/http.js';
import type { AiApi, Field, FieldInput, FieldsApi, ListFieldsArgs } from '../clients/services.js';

const { ErrorWithProps } = mercurius;

declare module 'mercurius' {
  interface MercuriusContext {
    call: CallContext;
    fieldsApi: FieldsApi;
    aiApi: AiApi;
  }
}

export type GatewayContext = MercuriusContext;

const DEFAULT_SOIL_PH = 6.0;
const DEFAULT_COVERAGE = 0.7;

function codeFor(status: number): string {
  if (status === 400 || status === 422) return 'BAD_USER_INPUT';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  return 'UPSTREAM_UNAVAILABLE';
}

/** Translate downstream HTTP failures into GraphQL errors with stable `extensions.code`. */
async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UpstreamError) {
      throw new ErrorWithProps(err.message, {
        code: codeFor(err.status),
        ...(err.code && { reason: err.code }),
        ...(err.details !== undefined && { details: err.details }),
      });
    }
    throw err;
  }
}

const stripNulls = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolvers: IResolvers<any, GatewayContext> = {
  Query: {
    fields: (_root, args: ListFieldsArgs, { fieldsApi, call }) =>
      upstream(() => fieldsApi.list(call, stripNulls(args))),

    field: async (_root, { id }: { id: string }, { fieldsApi, call }) => {
      try {
        return await upstream(() => fieldsApi.get(call, id));
      } catch (err) {
        // GraphQL idiom: a missing entity is `null`, not an error.
        if (
          err instanceof ErrorWithProps &&
          (err.extensions as { code?: string }).code === 'NOT_FOUND'
        )
          return null;
        throw err;
      }
    },

    yieldModel: async (_root, _args, { aiApi, call }) => {
      const info = await upstream(() => aiApi.modelInfo(call));
      return {
        version: info.version,
        trainedAt: info.trainedAt,
        r2: info.metrics.r2,
        maeTHa: info.metrics.mae_t_ha,
      };
    },
  },

  Mutation: {
    createField: (_root, { input }: { input: FieldInput }, { fieldsApi, call }) =>
      upstream(() => fieldsApi.create(call, stripNulls(input))),

    updateField: (_root, { id, input }: { id: string; input: FieldInput }, { fieldsApi, call }) =>
      upstream(() => fieldsApi.update(call, id, stripNulls(input))),

    deleteField: async (_root, { id }: { id: string }, { fieldsApi, call }) => {
      await upstream(() => fieldsApi.delete(call, id));
      return true;
    },
  },

  Field: {
    observations: (
      field: Field,
      { limit, cursor }: { limit: number; cursor?: string | null },
      { fieldsApi, call },
    ) =>
      upstream(() =>
        fieldsApi.observations(call, field.id, Math.min(limit, 50), cursor ?? undefined),
      ),

    yieldForecast: async (
      field: Field,
      { rainfallMm, avgTempC }: { rainfallMm: number; avgTempC: number },
      { aiApi, call },
    ) => {
      const vegetationCoverage = field.latestObservation?.vegetationCoverage ?? DEFAULT_COVERAGE;
      const res = await upstream(() =>
        aiApi.predictYield(call, {
          crop: field.crop,
          areaHa: field.areaHa,
          rainfallMm,
          avgTempC,
          soilPh: field.soilPh ?? DEFAULT_SOIL_PH,
          vegetationCoverage,
        }),
      );
      return { ...res, vegetationCoverageUsed: vegetationCoverage };
    },
  },
};
