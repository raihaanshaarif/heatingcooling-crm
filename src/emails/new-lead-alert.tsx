import { EmailLayout, type EmailBusiness } from "./layout";

export interface NewLeadAlertEmailProps {
  business: EmailBusiness;
  leadName: string;
  phone?: string | null;
  email?: string | null;
  suburb?: string | null;
  service?: string | null;
  message?: string | null;
  source: string;
  link: string;
}

export default function NewLeadAlertEmail(props: NewLeadAlertEmailProps) {
  const details = [
    `Name: ${props.leadName}`,
    props.phone ? `Phone: ${props.phone}` : null,
    props.email ? `Email: ${props.email}` : null,
    props.suburb ? `Suburb: ${props.suburb}` : null,
    props.service ? `Service: ${props.service}` : null,
    `Source: ${props.source}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <EmailLayout
      preview={`New lead: ${props.leadName}`}
      business={props.business}
      paragraphs={[
        "A new lead just came in.",
        details,
        ...(props.message ? [`Message:\n${props.message}`] : []),
      ]}
      cta={{ label: "Open lead in CoolOps", href: props.link }}
    />
  );
}

NewLeadAlertEmail.PreviewProps = {
  business: { businessName: "Cooling Service Melbourne" },
  leadName: "Tom Nguyen",
  phone: "0412 345 678",
  suburb: "Richmond",
  service: "Split system install",
  source: "Website form",
  link: "https://example.com/leads/1",
} satisfies NewLeadAlertEmailProps;
