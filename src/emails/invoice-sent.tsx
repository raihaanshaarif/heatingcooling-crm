import { EmailLayout, type EmailBusiness } from "./layout";

export interface InvoiceSentEmailProps {
  business: EmailBusiness;
  clientName: string;
  invoiceNumber: string;
  total: string;
  balance: string;
  dueDate: string;
  link: string;
  bankDetails?: string | null;
  body?: string;
}

export default function InvoiceSentEmail(props: InvoiceSentEmailProps) {
  const intro =
    props.body ??
    `Hi ${props.clientName},\n\nPlease find your invoice ${props.invoiceNumber} for ${props.total} inc GST. The balance of ${props.balance} is due by ${props.dueDate}.`;
  return (
    <EmailLayout
      preview={`Invoice ${props.invoiceNumber} from ${props.business.businessName}`}
      business={props.business}
      paragraphs={[
        intro,
        ...(props.bankDetails
          ? [`Pay by bank transfer:\n${props.bankDetails}\nReference: ${props.invoiceNumber}`]
          : []),
      ]}
      cta={{ label: "View invoice", href: props.link }}
    />
  );
}

InvoiceSentEmail.PreviewProps = {
  business: { businessName: "Cooling Service Melbourne" },
  clientName: "Sarah",
  invoiceNumber: "INV-0001",
  total: "$264.00",
  balance: "$264.00",
  dueDate: "14 Nov 2025",
  link: "https://example.com/i/abc",
  bankDetails: "BSB 063-000 · Account 1234 5678",
} satisfies InvoiceSentEmailProps;
