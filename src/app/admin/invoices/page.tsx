import { getDemoState } from "@/lib/demo-store";

export default function AdminInvoicesPage() {
  const invoices = getDemoState().invoices;

  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl">Faktury / Saldeo</h1>
      <p className="text-fog">
        Klienci wnioskują w panelu; sync idzie do Saldeo (`invoice.add`).
      </p>
      <ul className="space-y-3">
        {invoices.map((i) => (
          <li key={i.id} className="card-quiet flex items-center justify-between p-5">
            <div>
              <p className="font-semibold">{i.invoice_number ?? i.id}</p>
              <p className="text-sm text-fog">{i.status}</p>
            </div>
            {i.pdf_url ? (
              <a className="btn btn-ghost" href={i.pdf_url}>
                PDF
              </a>
            ) : null}
          </li>
        ))}
        {!invoices.length ? (
          <li className="text-fog">Brak faktur — utwórz z panelu klienta.</li>
        ) : null}
      </ul>
    </section>
  );
}
