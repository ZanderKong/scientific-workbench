export type ObjectRole =
  "sample" | "material" | "equipment" | "process" | "other";
export type Lifecycle = "active" | "deprecated" | "merged";
export type ExtractionStatus = "ready" | "pending" | "error";

export interface ResearchObject {
  id: string;
  version: number;
  canonicalName: string;
  role: ObjectRole;
  lifecycle: Lifecycle;
  redirectTo?: string;
  identityText?: string;
  recommendedPropertyIds?: string[];
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PropertyDefinition {
  id: string;
  version: number;
  canonicalName: string;
  dimension?: string;
  recommendedUnit?: string;
  aliases: string[];
  usageCount: number;
  lastUsedAt?: string;
}

export interface ReferenceOccurrence {
  id: string;
  blockId: string;
  operationId?: string;
  objectId?: string;
  intentId?: string;
  rawText: string;
  role: ObjectRole | "unresolved";
  start: number;
  end: number;
  status: "bound" | "unresolved" | "ambiguous" | "create-intent";
}

export interface PropertyValue {
  id: string;
  blockId: string;
  objectId: string;
  propertyId: string;
  propertyName: string;
  valueText: string;
  sourceLine: number;
  sourceColumn: number;
}

export interface DataComponent {
  id: string;
  kind: "file" | "text";
  name: string;
  role: string;
  creator: "human" | "external";
  provenance: string;
  createdAt: string;
  derivedFrom: string[];
  attachmentId?: string;
  bodyLinked?: boolean;
  content?: string;
}

export interface DataRecord {
  id: string;
  name: string;
  description: string;
  version: number;
  aboutSampleIds: string[];
  sourceDocumentId?: string;
  sourceBlockId?: string;
  componentIds: string[];
  components: DataComponent[];
  updatedAt: string;
}

export interface RemoteAttachmentLocation {
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  forcePathStyle: boolean;
  credentialId: string;
}
export interface Attachment {
  id: string;
  sha256: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  localPath: string;
  createdAt: string;
  remoteKey?: string;
  remoteLocation?: RemoteAttachmentLocation;
  remoteOnly?: boolean;
}

export interface ParsedRecord {
  blockId: string;
  line: number;
  text: string;
  references: ReferenceOccurrence[];
  properties: PropertyValue[];
  data?: { id: string; name: string; blockId: string };
  dataItems?: { id: string; name: string; blockId: string; body: string }[];
  warnings: string[];
  invalidSegments?: { line: number; text: string; reason: string }[];
}

export interface ParseResult {
  documentId: string;
  bodyHash: string;
  records: ParsedRecord[];
  invalidSegments: { line: number; text: string; reason: string }[];
  warnings: string[];
  intents: { name: string; role: ObjectRole; blockId: string }[];
}

export interface DocumentHead {
  schema:
    | "swb.sample/1"
    | "swb.data/1"
    | "swb.analysis/1"
    | "swb.claim/1"
    | "swb.sample/2"
    | "swb.data/2"
    | "swb.analysis/2"
    | "swb.claim/2";
  entityType: "sample" | "data" | "analysis" | "claim";
  id: string;
  code?: string;
  contentVersion: number;
  bodyHash: string;
  extractionStatus: ExtractionStatus;
  extractionError?: string;
  projectionVersion: number;
  blocks: Record<
    string,
    {
      kind: string;
      dataId?: string;
      candidateDataIds?: string[];
      baseVersion?: number;
      baseHash?: string;
      baseName?: string;
      dataBlockIds?: Record<string, string>;
    }
  >;
  references?: ReferenceOccurrence[];
  usages?: { operationId: string; objectId: string }[];
  extracted?: {
    id?: string;
    objectId: string;
    propertyId: string;
    valueText: string;
    blockId: string;
    sourceLine?: number;
    sourceColumn?: number;
  }[];
  sample?: { title: string; createdAt: string };
  data?: DataRecord;
  analysis?: Omit<AnalysisRecord, "body">;
  claim?: Omit<ClaimRecord, "text" | "evidence"> & { evidenceIds: string[] };
  updatedAt: string;
}

export interface DocumentFile {
  head: DocumentHead;
  body: string;
}

export interface ClaimEvidence {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  bodyHash: string;
  content: string;
  attachmentIds: string[];
  capturedAt: string;
  manifest?: ContextManifest;
  documents?: Record<string, string>;
}

export interface ContextManifest {
  host: { type: "data" | "analysis"; id: string; version: number };
  entities: {
    type: string;
    id: string;
    version: number;
    bodyHash: string;
    file: string;
  }[];
  attachments: {
    id: string;
    sha256: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }[];
  identities: { id: string; type: string; name: string; reason: string }[];
  relations: { fromId: string; toId: string; kind: string; blockId?: string }[];
  warnings: string[];
}

export interface ClaimRecord {
  id: string;
  version: number;
  hostType: "data" | "analysis";
  hostId: string;
  text: string;
  legacyEvidenceWarning?: string;
  evidence: ClaimEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisLayout {
  visibleSections: string[];
  hiddenColumns: string[];
  columnOrder: string[];
}

export interface AnalysisRecord {
  id: string;
  version: number;
  title: string;
  question: string;
  body: string;
  itemIds: string[];
  layout: AnalysisLayout;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  entityType: string;
  entityId: string;
  bodyHash: string;
  body: string;
  createdAt: string;
}

export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  payload: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
