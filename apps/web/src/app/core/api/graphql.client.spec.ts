import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GraphqlClient, GraphqlError } from './graphql.client';

describe('GraphqlClient', () => {
  let client: GraphqlClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(GraphqlClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends queries as cacheable GET requests', async () => {
    const p = client.query<{ ok: boolean }>('query {\n  ok\n}', { a: 1 });
    const req = http.expectOne((r) => r.url === '/graphql');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('query')).toBe('query { ok }');
    expect(req.request.params.get('variables')).toBe('{"a":1}');
    req.flush({ data: { ok: true } });
    expect(await p).toEqual({ ok: true });
  });

  it('sends fresh queries and mutations as POST', async () => {
    const p = client.query('query { x }', {}, { fresh: true });
    const req = http.expectOne('/graphql');
    expect(req.request.method).toBe('POST');
    req.flush({ data: { x: 1 } });
    await p;
  });

  it('surfaces GraphQL errors with their code', async () => {
    const p = client.mutate('mutation { x }');
    http.expectOne('/graphql').flush({
      data: null,
      errors: [{ message: 'Polygon invalid', extensions: { code: 'BAD_USER_INPUT' } }],
    });
    await expect(p).rejects.toMatchObject({ code: 'BAD_USER_INPUT', message: 'Polygon invalid' });
  });

  it('maps network failures to NETWORK', async () => {
    const p = client.query('query { x }');
    http.expectOne((r) => r.url === '/graphql').error(new ProgressEvent('error'), { status: 0 });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphqlError);
    expect((err as GraphqlError).code).toBe('NETWORK');
  });
});
