// Read-only against the user's workspace: all fixtures live in a fresh OS temp directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchStore } from '../apps/server/src/store';
import { StorageService } from '../apps/server/src/storage';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-audit-'));
const store = new WorkbenchStore({dataDir:path.join(root,'source')});
const storage = new StorageService(store);
const findings: Record<string, unknown> = {};
try {
  store.createObject({canonicalName:'水',role:'material'});
  const s = store.createSample({body:'- 添加 [水]\n  - [水]｜添加量：5 g\n  - [数据] FTIR\n    - 实测描述 A\n  - [数据] DSC'});
  store.finalizeDocument(s.id);
  findings.twoDataBlocks = {expected:2, actual:store.listData().length, firstBody:store.listData()[0]?.body};
  findings.listProjection = {detailCount:store.getSample(s.id).properties.length,listHasProperties:'properties' in store.listSamples()[0]};
  const data = store.createData({name:'独立数据',body:'真实应导出的测试正文',aboutSampleIds:[s.id]});
  const a = store.createAnalysis({title:'分析',body:'分析正文',itemIds:[s.id,data.id]});
  const claim = store.createClaim({hostType:'analysis',hostId:a.id,text:'测试论点'});
  findings.analysisEvidence = claim.evidence.map(e=>({entityType:e.entityType,content:e.content}));
  const edited = store.readDocument(s.id);
  fs.writeFileSync(edited.filePath,fs.readFileSync(edited.filePath,'utf8').replaceAll('5 g','6 g'));
  const reload = store.readDocument(s.id);
  try { store.saveDocument(s.id,reload.body,reload.head.contentVersion); findings.reloadThenSave='success'; }
  catch(e) { findings.reloadThenSave=String(e); }
  // Synthetic credentials only; no real account or network access.
  storage.configure({accessKeyId:'AUDIT_FAKE_KEY',secretAccessKey:'AUDIT_FAKE_SECRET'});
  findings.credentialsInIndex = String((store.db.prepare("SELECT value FROM settings WHERE key='s3'").get() as any).value).includes('AUDIT_FAKE_SECRET');
  const attachment = store.saveAttachment(Buffer.from('audit file'),'audit.txt','text/plain');
  store.db.prepare('UPDATE attachments SET remote_only=1,remote_key=? WHERE id=?').run('fake-key',attachment.id);
  fs.unlinkSync(attachment.localPath);
  const backup = await storage.createBackup();
  findings.backupWithMissingRemote = {reportedSuccess:!!backup.file};
  const target = path.join(root,'restore');
  const restored = await storage.restoreBackup(backup.file,target);
  const restoredStore = new WorkbenchStore({dataDir:target});
  findings.restore = {verified:restored.verified,documentPath:restoredStore.readDocument(s.id).filePath,expectedPrefix:target};
  restoredStore.close();
  const fileOnly = path.join(root,'file-only'); fs.mkdirSync(fileOnly);
  for(const dir of ['samples','data','analyses','claims','registry','attachments','history','evidence']) fs.cpSync(path.join(store.dataDir,dir),path.join(fileOnly,dir),{recursive:true});
  const rebuilt = new WorkbenchStore({dataDir:fileOnly}); rebuilt.rebuildIndex();
  findings.fileOnlyRebuild = {objects:rebuilt.searchObjects().length,data:rebuilt.listData().length,analyses:rebuilt.listAnalyses().length,claims:rebuilt.listClaims().length};
  rebuilt.close();
  console.log(JSON.stringify(findings,null,2));
} finally { store.close(); fs.rmSync(root,{recursive:true,force:true}); }
