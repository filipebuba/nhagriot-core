// Remove formatação Markdown que os LLMs (DeepSeek/Gemini) insistem em devolver
// — asteriscos de **negrito**/*itálico*, ### títulos, listas com - / *, `código`,
// [links](url), > citações — deixando texto limpo e legível.
//
// Por quê: as respostas da IA (Converse com o documento, Pacote de Estudos) eram
// exibidas cruas e a limpeza de narração era LIDA em voz alta — então os
// asteriscos viravam "sujeira" na tela e "asterisco" falado pelo narrador.
//
// Não é um renderizador de Markdown: é um higienizador para PROSA. Preserva o
// conteúdo e a ordem; só tira os símbolos de marcação.
export function stripMarkdown(input: string): string {
  if (!input) return "";
  let t = input.replace(/\r\n?/g, "\n");

  // Cercas de código ```lang ... ``` → mantém o conteúdo, remove as cercas.
  t = t.replace(/```[^\n]*\n?/g, "");
  // Código inline `assim` → assim
  t = t.replace(/`([^`]+)`/g, "$1");
  // Imagens ![alt](url) → alt ; Links [texto](url) → texto
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Marcação por linha: títulos, citações, regras horizontais e marcadores de lista.
  t = t
    .split("\n")
    .map((line) => {
      // Régua horizontal (---, ***, ___) vira linha vazia.
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "";
      let l = line;
      l = l.replace(/^\s{0,3}#{1,6}\s+/, ""); // # Título
      l = l.replace(/^\s{0,3}>\s?/, "");        // > citação
      l = l.replace(/^(\s*)[-*+]\s+/, "$1");    // - / * / + marcador de lista
      return l;
    })
    .join("\n");

  // Ênfase: negrito/itálico em qualquer combinação.
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "$1"); // ***x***
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");     // **x**
  t = t.replace(/\*([^*\n]+)\*/g, "$1");       // *x*
  t = t.replace(/___([^_]+)___/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  // _itálico_ só quando isolado por espaço/pontuação/borda (preserva snake_case).
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1$2");

  // Restos de asteriscos de marcação (pares desbalanceados) — sem mexer em " * "
  // isolado (ex.: multiplicação). Remove só os colados a texto.
  t = t.replace(/\*{2,}/g, "");
  t = t.replace(/\*(?=\S)/g, "");
  t = t.replace(/(\S)\*/g, "$1");

  // Normaliza espaços/linhas em branco.
  t = t.replace(/[ \t]+$/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
