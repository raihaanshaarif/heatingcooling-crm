import { EmailLayout, type EmailBusiness } from "./layout";

export interface QuoteSentEmailProps {
  business: EmailBusiness;
  clientName: string;
  quoteNumber: string;
  title: string;
  total: string;
  validUntil?: string;
  link: string;
  body?: string;
}

export default function QuoteSentEmail(props: QuoteSentEmailProps) {
  const intro =
    props.body ??
    `Hi ${props.clientName},\n\nThanks for the opportunity to quote. Your quote ${props.quoteNumber} for "${props.title}" is ready (${props.total} inc GST${props.validUntil ? `, valid until ${props.validUntil}` : ""}).\n\nYou can view the options and accept online using the button below.`;
  return (
    <EmailLayout
      preview={`Quote ${props.quoteNumber} from ${props.business.businessName}`}
      business={props.business}
      paragraphs={[intro]}
      cta={{ label: "View and accept quote", href: props.link }}
    />
  );
}

QuoteSentEmail.PreviewProps = {
  business: { businessName: "Cooling Service Melbourne", phone: "(03) 9000 0000" },
  clientName: "Sarah",
  quoteNumber: "Q-0001",
  title: "Supply and install 7.1kW split system",
  total: "$3,289.00",
  validUntil: "30 Nov 2025",
  link: "https://example.com/q/abc",
} satisfies QuoteSentEmailProps;
