import type { ReviewSnapshot } from '../lib/types';
import type { EvidenceRef } from '../lib/reviewSchema';
import type { WebGuide } from '../lib/webGuide';

export default function WebGuideResult({ guide, snapshot, stale, onLocate }: {
  guide: WebGuide; snapshot: ReviewSnapshot; stale: boolean; onLocate: (ref: EvidenceRef) => void;
}) {
  const page = snapshot.page!;
  return <article className="web-guide" aria-label="网页导读">
    <div className="web-publication"><a href={snapshot.pageUrl!} target="_blank" rel="noreferrer noopener">{page.site} ↗</a><span>{page.kind === 'post' ? '长帖' : '文章'} · 约 {page.readingMinutes} 分钟</span></div>
    <h2 className="web-title">{page.title}</h2>
    {(page.author || page.published) && <p className="web-byline">{[page.author, page.published?.slice(0,10)].filter(Boolean).join(' · ')}</p>}
    <section className="web-overview"><h3>这篇在讲什么</h3><p>{guide.overview.text}</p></section>
    <section className="web-map" aria-label="阅读地图"><div className="web-section-head"><h3>阅读地图</h3><span>选择一处，回到原文</span></div>
      <ol>{guide.sections.map((section, i) => <li key={i}><span className="web-step">{String(i + 1).padStart(2, '0')}</span><div>
        <h4>{section.title}</h4><p>{section.text}</p>
        {section.evidence[0] && <button className="web-jump" disabled={stale} onClick={() => onLocate(section.evidence[0]!)} aria-label={'阅读原文：' + section.title}>阅读这一部分 <span aria-hidden="true">↗</span></button>}
      </div></li>)}</ol>
    </section>
    {!!guide.cautions.length && <section className="web-cautions"><h3>带着这些提醒读</h3>{guide.cautions.map((item, i) => <div key={i}><p>{item.text}</p><details><summary>查看依据</summary>{item.evidence.map((ref, j) => <div key={j}><blockquote>{ref.exactQuote}</blockquote><button className="text-button" disabled={stale} onClick={() => onLocate(ref)}>定位原文</button></div>)}</details></div>)}</section>}
    {guide.partial && <p className="web-scope">部分引用定位未通过校验，已移除无依据的提醒。</p>}
    <p className="web-scope">基于当前可读取正文 · 未核验外部事实</p>
  </article>;
}
