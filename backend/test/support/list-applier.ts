// SPEC-004 integration helpers: the real ListApplier over the spec's own database, and a builder
// of list rows. Only the clock is a fake (TS-06); the repositories, the services and MongoDB are
// the production ones.
import { getModelToken } from '@nestjs/mongoose';
import type { TestingModule } from '@nestjs/testing';
import type { Model, Types } from 'mongoose';
import { PropertyChangeRepository } from '../../src/auctions/changes/property-change.repository.js';
import {
  PropertyChangeEntity,
  type PropertyChangeDocument,
} from '../../src/auctions/changes/property-change.schema.js';
import { PropertyChangeService } from '../../src/auctions/changes/property-change.service.js';
import type { ListRow } from '../../src/auctions/domain/list-diff.js';
import { PhaseModality } from '../../src/auctions/domain/modality.js';
import { ImportRunRepository } from '../../src/auctions/import-runs/import-run.repository.js';
import {
  ImportRunEntity,
  type ImportRunDocument,
} from '../../src/auctions/import-runs/import-run.schema.js';
import { ImportRunService } from '../../src/auctions/import-runs/import-run.service.js';
import { ListApplier } from '../../src/auctions/importer/list-applier.service.js';
import { ListApplierRepository } from '../../src/auctions/importer/list-applier.repository.js';
import { AuctionEntity, type AuctionDocument } from '../../src/auctions/schemas/auction.schema.js';
import { Clock } from '../../src/common/clock/clock.js';
import { Decimal } from '../../src/common/money/money.js';

/** The models a SPEC-004 integration spec registers with `MongooseModule.forFeature`. */
export const IMPORT_MODELS = [AuctionEntity, ImportRunEntity, PropertyChangeEntity] as const;

export interface ImportKit {
  applier: ListApplier;
  properties: ListApplierRepository;
  changes: PropertyChangeService;
  runs: ImportRunService;
  auctionModel: Model<AuctionDocument>;
  changeModel: Model<PropertyChangeDocument>;
  runModel: Model<ImportRunDocument>;
}

/** The services of the import, built over the models of `moduleRef` and a clock. */
export function importKit(moduleRef: TestingModule, clock: Clock): ImportKit {
  const auctionModel = moduleRef.get<Model<AuctionDocument>>(getModelToken(AuctionEntity.name));
  const changeModel = moduleRef.get<Model<PropertyChangeDocument>>(
    getModelToken(PropertyChangeEntity.name),
  );
  const runModel = moduleRef.get<Model<ImportRunDocument>>(getModelToken(ImportRunEntity.name));
  const properties = new ListApplierRepository(auctionModel);
  const changes = new PropertyChangeService(new PropertyChangeRepository(changeModel));
  return {
    applier: new ListApplier(properties, changes, clock),
    properties,
    changes,
    runs: new ImportRunService(new ImportRunRepository(runModel), clock),
    auctionModel,
    changeModel,
    runModel,
  };
}

/** A list row; every field a spec does not name is a plausible, fake value (TS-27). */
export function aRow(code: string, overrides: Partial<ListRow> = {}): ListRow {
  return {
    code,
    title: `Casa, 60 m2 (${code})`,
    address: { street: 'RUA TESTE, 1', neighborhood: 'CENTRO', city: 'CAMPINAS', state: 'SP' },
    appraisalPrice: new Decimal('200000'),
    minimumPrice: new Decimal('150000'),
    modality: PhaseModality.SFI_AUCTION,
    detailsUrl: `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}`,
    propertyType: 'Casa',
    ...overrides,
  };
}

export function runIdOf(id: Types.ObjectId): string {
  return id.toHexString();
}
