import { EmailLayout, type EmailBusiness } from "./layout";

export interface ServiceDueReminderEmailProps {
  business: EmailBusiness;
  clientName: string;
  planName: string;
  dueDate: string;
  address?: string | null;
  body?: string;
}

export default function ServiceDueReminderEmail(props: ServiceDueReminderEmailProps) {
  const intro =
    props.body ??
    `Hi ${props.clientName},\n\nYour ${props.planName} is due on ${props.dueDate}${props.address ? ` at ${props.address}` : ""}. Regular servicing keeps your system efficient, reliable and within warranty.\n\nReply to this email or give us a call and we'll lock in a time that suits you.`;
  return (
    <EmailLayout
      preview={`Your ${props.planName} is due`}
      business={props.business}
      paragraphs={[intro]}
    />
  );
}

ServiceDueReminderEmail.PreviewProps = {
  business: { businessName: "Cooling Service Melbourne", phone: "(03) 9000 0000" },
  clientName: "Sarah",
  planName: "annual split system service",
  dueDate: "1 Dec 2025",
  address: "12 Smith St, Brunswick VIC 3056",
} satisfies ServiceDueReminderEmailProps;
