import { EmailLayout, type EmailBusiness } from "./layout";

export interface InvoiceOverdueEmailProps {
  business: EmailBusiness;
  clientName: string;
  invoiceNumber: string;
  balance: string;
  dueDate: string;
  daysOverdue: number;
  link: string;
  bankDetails?: string | null;
  body?: string;
}

export default function InvoiceOverdueEmail(props: InvoiceOverdueEmailProps) {
  const intro =
    props.body ??
    `Hi ${props.clientName},\n\nThis is a friendly reminder that invoice ${props.invoiceNumber} was due on ${props.dueDate} and ${props.balance} is still outstanding (${props.daysOverdue} day${props.daysOverdue === 1 ? "" : "s"} overdue).\n\nIf you've already paid, thank you, and please ignore this email.`;
  return (
    <EmailLayout
      preview={`Reminder: invoice ${props.invoiceNumber} is overdue`}
      business={props.business}
      paragraphs={[
        intro,
        ...(props.bankDetails
          ? [`Bank details:\n${props.bankDetails}\nReference: ${props.invoiceNumber}`]
          : []),
      ]}
      cta={{ label: "View invoice", href: props.link }}
    />
  );
}

InvoiceOverdueEmail.PreviewProps = {
  business: { businessName: "Cooling Service Melbourne" },
  clientName: "Sarah",
  invoiceNumber: "INV-0001",
  balance: "$264.00",
  dueDate: "14 Nov 2025",
  daysOverdue: 7,
  link: "https://example.com/i/abc",
} satisfies InvoiceOverdueEmailProps;
