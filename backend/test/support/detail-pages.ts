// SPEC-004 part 4: synthetic Caixa detail pages for the specs that need a page to say something
// specific (dates in the future, financing or not, which photos, which edital). Anonymised and
// invented (TS-27): no owner, no CPF, no matrícula text. The markup follows the real pages
// (test/fixtures/caixa/sfi-auction.html and its siblings), which is what the extractor reads.
import { JPEG_BYTES, PDF_BYTES } from './file-bytes.js';

export interface PageSpec {
  /** `Data do 1º Leilão` / `Data do 2º Leilão` (SFI), written as Caixa does: DD/MM/YYYY - HHhMM. */
  sfiDates?: [string, string?];
  /** `Data da Licitação Aberta` (open bidding). */
  openBiddingDate?: string;
  /** Written "R$ 192.622,00". */
  firstPrice?: string;
  secondPrice?: string;
  singlePrice?: string;
  methods?: ('own' | 'fgts' | 'financing')[] | null;
  occupancy?: string;
  type?: string;
  photos?: string[];
  matricula?: string | null;
  edital?: { path: string; published?: string } | null;
  description?: string;
}

export function detailPage(spec: PageSpec = {}): string {
  const prices =
    spec.firstPrice !== undefined
      ? `<b>Valor mínimo de venda 1º Leilão: R$ ${spec.firstPrice}</b><br>Valor mínimo de venda 2º Leilão: R$ ${spec.secondPrice ?? '0,00'}`
      : `<b>Valor mínimo de venda: R$ ${spec.singlePrice ?? '100.000,00'}</b>`;
  const dates = [
    spec.sfiDates?.[0] === undefined
      ? ''
      : `<span><i class="fa fa-gavel"></i> Data do 1º Leilão - ${spec.sfiDates[0]}</span><br>`,
    spec.sfiDates?.[1] === undefined
      ? ''
      : `<span><i class="fa fa-gavel"></i> Data do 2º Leilão - ${spec.sfiDates[1]}</span><br>`,
    spec.openBiddingDate === undefined
      ? ''
      : `<span><i class="fa fa-gavel"></i> Data da Licitação Aberta - ${spec.openBiddingDate}</span><br>`,
  ].join('');
  const labels = {
    own: 'Recursos próprios.',
    fgts: 'Permite utilização de FGTS. Consulte condições e enquadramento.',
    financing: 'Permite financiamento habitacional.',
  };
  const payment =
    spec.methods === null
      ? ''
      : `<p>FORMAS DE PAGAMENTO ACEITAS:<br>${(spec.methods ?? ['own'])
          .map((method) => `<i class="fa fa-info-circle"></i>&nbsp;${labels[method]}<br>`)
          .join(
            '',
          )}<br>REGRAS PARA PAGAMENTO DAS DESPESAS (caso existam):<br><i class="fa fa-info-circle"></i>&nbsp;Condomínio: Sob responsabilidade do comprador.<br></p>`;
  const matricula =
    spec.matricula === null
      ? ''
      : `<span><a href="#" onclick="javascript:ExibeDoc('${spec.matricula ?? '/editais/matricula/XX/1.pdf'}')">Baixar matrícula do imóvel</a></span>`;
  const edital =
    spec.edital === null
      ? ''
      : `<ul><li><span><a href="#" onclick="javascript:ExibeDoc('${spec.edital?.path ?? '/editais/EL0001.PDF'}')"><strong>Baixar edital e anexos</strong></a></span><br><span>(Edital publicado em: ${spec.edital?.published ?? '23/01/2026 11:58:46'})</span></li></ul>`;
  const photos = (spec.photos ?? ['/fotos/F1.jpg'])
    .map((src) => `<img src="${src}" alt="Foto do imóvel">`)
    .join('');
  return `<html><body><form><div id="dadosImovel"><div class="content">
<p style="font-size:14pt">Valor de avaliação: R$ 200.000,00<br>${prices}</p>
<div class="control-item"><p>
<span>Tipo de imóvel: <strong>${spec.type ?? 'Casa'}</strong></span><br>
${spec.occupancy === undefined ? '' : `<span>Situação: <strong>${spec.occupancy}</strong></span><br>`}
</p></div>
<div class="related-box">${dates}${matricula}
<p><strong>Descrição:</strong><br>${spec.description ?? 'Imóvel sintético para teste.'}</p>${payment}${edital}</div>
</div></div>
<div id="galeria-imagens"><div class="thumbnails">${photos}</div></div></form></body></html>`;
}

/** What Caixa serves for a photo and a PDF: the bytes a spec stores and compares. */
export const SERVED_JPEG = { body: JPEG_BYTES, contentType: 'image/jpeg' };
export const SERVED_PDF = { body: PDF_BYTES, contentType: 'application/pdf' };
