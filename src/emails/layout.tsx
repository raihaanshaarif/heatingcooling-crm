import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface EmailBusiness {
  businessName: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  abn?: string | null;
}

export function EmailLayout({
  preview,
  business,
  paragraphs,
  cta,
  children,
}: {
  preview: string;
  business: EmailBusiness;
  paragraphs: string[];
  cta?: { label: string; href: string };
  children?: React.ReactNode;
}) {
  return (
    <Html lang="en-AU">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: "#f4f4f5",
          fontFamily: "Helvetica, Arial, sans-serif",
          margin: 0,
          padding: "24px 0",
        }}
      >
        <Container
          style={{ backgroundColor: "#ffffff", borderRadius: 8, padding: "32px", maxWidth: 560 }}
        >
          <Text style={{ fontSize: 18, fontWeight: 700, color: "#0284c7", margin: "0 0 16px" }}>
            {business.businessName}
          </Text>
          {paragraphs.map((p, i) => (
            <Text
              key={i}
              style={{ fontSize: 15, lineHeight: "24px", color: "#18181b", whiteSpace: "pre-line" }}
            >
              {p}
            </Text>
          ))}
          {children}
          {cta && (
            <Section style={{ margin: "24px 0" }}>
              <Button
                href={cta.href}
                style={{
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  padding: "12px 20px",
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {cta.label}
              </Button>
            </Section>
          )}
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <Text style={{ fontSize: 12, color: "#71717a", lineHeight: "18px" }}>
            {business.businessName}
            {business.abn ? ` · ABN ${business.abn}` : ""}
            {business.phone ? ` · ${business.phone}` : ""}
            {business.email ? ` · ${business.email}` : ""}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
