import { useEffect, useState } from 'react';
import type { Attachment } from '@workbench/core';
import { Modal } from './Modal';
export function AttachmentPreview({ file, close }: { file: Attachment; close: () => void }) {
  const url = `/api/v1/attachments/${encodeURIComponent(file.id)}/content`;
  const [text, setText] = useState('');
  const isText = /^(text\/|application\/json)/.test(file.mimeType);
  useEffect(() => {
    if (!isText) return;
    const controller = new AbortController();
    if (file.sizeBytes > 2_000_000) { setText('文本超过 2 MB，请下载查看。'); return; }
    void fetch(url, { signal: controller.signal }).then(async response => { if (!response.ok) throw Error('读取附件失败'); return response.text(); }).then(setText).catch(error => { if (!controller.signal.aborted) setText(error.message); });
    return () => controller.abort();
  }, [url, isText, file.sizeBytes]);
  return <Modal title={file.originalName} close={close} footer={<a href={`${url}?download=1`} download={file.originalName}>下载原文件</a>}>
    {/^(image\/(png|jpeg|gif|webp))$/.test(file.mimeType) ? <img className="attachmentImage" src={url} alt={file.originalName}/> : file.mimeType === 'application/pdf' ? <iframe className="attachmentPdf" title={file.originalName} src={url} sandbox=""/> : isText ? <pre className="noteCode">{text}</pre> : <p>{file.mimeType} · {file.sizeBytes.toLocaleString()} 字节，请下载查看。</p>}
    <p className="noteIntro">SHA-256：{file.sha256}</p>
  </Modal>;
}
