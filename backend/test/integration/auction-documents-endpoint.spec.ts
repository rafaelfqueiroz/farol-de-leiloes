// SPEC-004 BR-004-22, SC-07, SC-15, SC-18: `GET /api/auctions/:code/matricula-link` at the HTTP level
// (Testcontainers MongoDB, the app's own setup and the production guards; only the JWT strategy and
// the R2 bucket are stand-ins). Admin only: 401 without a token, 403 for a signed-in account that is
// not an admin, 404 for a property with no private copy, 200 with a 60-second link; the access log
// holds a counter and the property number, never who asked.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injectable, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
import { configureApp } from '../../src/app.setup.js';
import { AccessModule } from '../../src/access/access.module.js';
import { AccessContextGuard } from '../../src/access/guards/access-context.guard.js';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard.js';
import { AuctionsService } from '../../src/auctions/auctions.service.js';
import { AuctionDocumentsController } from '../../src/auctions/documents/auction-documents.controller.js';
import { AuctionDocumentsService } from '../../src/auctions/documents/auction-documents.service.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { FakeCopyStorage } from '../fakes/fake-copy-storage.js';
import { captureAllLogOutput } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import { testConfigService, testEnv } from '../support/test-env.js';

const SECRET = 'documents-spec-secret-not-a-real-one';
const ADMIN_ID = '64b7f0000000000000000001';
const STANDARD_ID = '64b7f0000000000000000002';
const KEY = 'private/auctions/0001/matricula/abcdef0123456789.pdf';

@Injectable()
class SpecJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }

  validate(payload: { sub: string; isAdmin: boolean }) {
    return { userId: payload.sub, isAdmin: payload.isAdmin, emailVerified: true };
  }
}

describe('GET /api/auctions/:code/matricula-link (integration)', () => {
  const db = useTestDatabase();
  const storage = new FakeCopyStorage();
  const properties = new Map<string, { matricula?: { storageKey?: string } }>();
  let app: INestApplication;
  let adminToken: string;
  let standardToken: string;

  beforeAll(async () => {
    applyMongooseDefaults();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        MongooseModule.forRoot(db.uri),
        JwtModule.register({ secret: SECRET }),
        AccessModule,
      ],
      controllers: [AuctionDocumentsController],
      providers: [
        AuctionDocumentsService,
        {
          provide: AuctionsService,
          useValue: { findDocumentByCode: async (code: string) => properties.get(code) ?? null },
        },
        { provide: StorageService, useValue: storage },
        SpecJwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: AccessContextGuard },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const jwt = moduleRef.get(JwtService);
    adminToken = jwt.sign({ sub: ADMIN_ID, isAdmin: true });
    standardToken = jwt.sign({ sub: STANDARD_ID, isAdmin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    properties.clear();
    storage.privateFiles.clear();
    storage.linkRequests.length = 0;
    properties.set('0001', { matricula: { storageKey: KEY } });
    properties.set('0002', {});
    storage.privateFiles.set(KEY, {
      body: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    });
  });

  const get = (code: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/auctions/${code}/matricula-link`);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };

  it('answers 401 without a token and issues nothing', async () => {
    await get('0001').expect(401);
    expect(storage.linkRequests).toEqual([]);
  });

  it('answers 403 to a signed-in account that is not an admin, and issues nothing', async () => {
    await get('0001', standardToken).expect(403);
    expect(storage.linkRequests).toEqual([]);
  });

  it.each(['0002', '9999'])(
    'answers 404 AUCTION_NOT_FOUND to an admin for %s: no private copy',
    async (code) => {
      const response = await get(code, adminToken).expect(404);

      expect(response.body).toMatchObject({ code: 'AUCTION_NOT_FOUND' });
      expect(storage.linkRequests).toEqual([]);
    },
  );

  it('answers 200 to an admin with a 60-second link, and logs a counter and the property only', async () => {
    const capture = captureAllLogOutput();
    let first;
    let second;
    try {
      first = await get('0001', adminToken).expect(200);
      second = await get('0001', adminToken).expect(200);
    } finally {
      capture.restore();
    }

    expect(first.body).toEqual({
      url: expect.stringContaining('X-Amz-Expires=60'),
      expiresInSeconds: 60,
    });
    expect(second.body.expiresInSeconds).toBe(60);
    const text = capture.text();
    expect(text).toContain('matricula.link property=0001 issued=1');
    expect(text).toContain('matricula.link property=0001 issued=2');
    for (const secret of [ADMIN_ID, KEY, 'private-files.example.test', 'X-Amz']) {
      expect(text).not.toContain(secret);
    }
  });
});
