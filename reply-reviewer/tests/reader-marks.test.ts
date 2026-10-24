import { webcrypto, randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('wxt/utils/define-content-script',()=>({defineContentScript:(definition:unknown)=>definition}));
import reader from '../entrypoints/reader.content';
import { READER_CHANNEL } from '../lib/readerProtocol';
afterEach(()=>vi.unstubAllGlobals());
describe('生产采集器的原文提示清理竞态',()=>{
  it.each([['SET_HIGHLIGHTS','CLEAR_HIGHLIGHTS'],['LOCATE_BLOCK','CLEAR_HIGHLIGHTS'],['SET_HIGHLIGHTS','RELEASE'],['LOCATE_BLOCK','RELEASE']])('%s 验证等待期间 %s 使旧操作失效',async(operation,cancel)=>{
    const dom=new JSDOM('<div data-message-author-role="user">问</div><div data-message-author-role="assistant"><p>目标原句</p></div>',{url:'https://chatgpt.com/c/race'}),d=dom.window.document;
    const registry=new Map();Object.defineProperty(dom.window,'CSS',{value:{highlights:registry}});Object.defineProperty(dom.window,'Highlight',{value:class{}});
    let listener:any,dispose:()=>void=()=>{},gate:Promise<void>|null=null,started:()=>void=()=>{};
    vi.stubGlobal('document',d);vi.stubGlobal('location',d.location);vi.stubGlobal('MutationObserver',dom.window.MutationObserver);
    vi.stubGlobal('chrome',{runtime:{id:'synthetic',onMessage:{addListener:(f:any)=>{listener=f;},removeListener:()=>{}}}});
    vi.stubGlobal('crypto',{randomUUID,subtle:{digest:async(algorithm:any,data:any)=>{if(gate){const wait=gate;gate=null;started();await wait;}return webcrypto.subtle.digest(algorithm,data);}}});
    (reader as any).main({isInvalid:false,onInvalidated:(f:()=>void)=>{dispose=f;}});
    const send=(msg:object)=>new Promise<any>(resolve=>listener({...msg,requestId:randomUUID(),channel:READER_CHANNEL},{id:'synthetic'},resolve));
    try{
      const capture=await send({type:'CAPTURE'});expect(capture.ok).toBe(true);const snapshotId=capture.data.snapshotId;
      let release!:()=>void;gate=new Promise(resolve=>{release=resolve;});const entered=new Promise<void>(resolve=>{started=resolve;});
      const pending=send(operation==='SET_HIGHLIGHTS'?{type:operation,snapshotId,evidence:[{blockId:'b001',exactQuote:'目标原句'}]}:{type:operation,snapshotId,blockId:'b001',exactQuote:'目标原句'});
      await entered;await send(cancel==='RELEASE'?{type:cancel}:{type:cancel,snapshotId});expect(registry.size).toBe(0);
      release();const result=await pending;expect(result.ok).toBe(false);expect(registry.size).toBe(0);expect(d.querySelector('p')!.style.outline).toBe('');
    }finally{dispose();dom.window.close();}
  });
});
