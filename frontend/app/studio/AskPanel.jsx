"use client";

import { useState } from "react";
import { Btn, Empty, Icon, INPUT, Section } from "./ui";

export default function AskPanel({ s }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState([]);

  const ask = () =>
    s.run("Reading the document...", async () => {
      if (!question.trim()) return;
      const data = await s.post("/assistant", { question });
      setAnswer(data?.answer || "");
      setCitations(data?.citations || []);
    });

  return (
    <div className="space-y-3">
      <Section title="Find in document" hint="Search the extracted text and jump to each match.">
        <div className="flex gap-1.5">
          <input className={INPUT} value={s.searchQuery} placeholder="Search words or a phrase"
            onChange={(event) => s.setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") s.search(); }} />
          <Btn size="sm" icon="search" onClick={s.search} aria-label="Search" />
        </div>
        {s.searchResults.length ? (
          <ul className="mt-2 max-h-52 space-y-1 overflow-auto pr-1">
            {s.searchResults.map((result, index) => (
              <li key={`${result.page}-${index}`}>
                <button type="button" onClick={() => s.setPageNumber(result.page)}
                  className="w-full rounded-lg border border-[#2d5871] bg-[#103a55] px-2.5 py-2 text-left transition hover:border-[#f84f63]/60">
                  <span className="mr-2 rounded bg-[#f84f63]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#ffb3bc]">p.{result.page}</span>
                  <span className="text-[11px] text-[#c9dfe3]">{result.snippet || s.searchQuery}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : s.searchQuery && !s.searchBusy ? (
          <p className="mt-2 text-[11px] text-[#7f9dab]">Press Enter or the search button to look through every page.</p>
        ) : null}
      </Section>

      <Section title="Ask this document" hint="Answers are grounded in the document text; nothing is uploaded anywhere.">
        <textarea className={`${INPUT} h-20 resize-none`} value={question} placeholder="e.g. What is the maximum stress in analysis 3?"
          onChange={(event) => setQuestion(event.target.value)} />
        <Btn size="sm" className="mt-2 w-full" icon="spark" onClick={ask}>Ask</Btn>
        {answer ? (
          <div className="mt-2 rounded-lg border border-[#2d5871] bg-[#103a55] px-3 py-2.5">
            <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#d7e9ec]">{answer}</p>
            {citations.length ? (
              <div className="mt-2 space-y-1 border-t border-[#2d5871] pt-2">
                {citations.map((citation, index) => (
                  <button key={index} type="button" onClick={() => s.setPageNumber(citation.page)}
                    className="block w-full text-left text-[10px] leading-4 text-[#8ed0c9] hover:text-white">
                    p.{citation.page}: {citation.snippet}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title="How it works">
        <ul className="space-y-2 text-[11px] leading-4 text-[#9db8c4]">
          <li className="flex gap-2"><Icon name="search" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />Search runs over the PDF text layer and returns page positions.</li>
          <li className="flex gap-2"><Icon name="spark" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />The assistant ranks sentences by word overlap and quotes the closest passages.</li>
          <li className="flex gap-2"><Icon name="ocr" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7fd3c9]" />For scans, run OCR in Tools first so there is text to search.</li>
        </ul>
        {!s.info?.page_count ? <Empty>Open a document to search it.</Empty> : null}
      </Section>
    </div>
  );
}
