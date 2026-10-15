import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export interface PdfBusiness {
  businessName: string;
  tradingName?: string | null;
  abn?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  logo?: { data: Buffer; format: "png" | "jpg" } | null;
  gstRegistered: boolean;
}

export interface PdfLine {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  taxable: boolean;
}

export interface PdfSection {
  heading?: string;
  description?: string | null;
  lines: PdfLine[];
  subtotal: string;
  gst: string;
  total: string;
  highlight?: boolean;
}

export interface PdfDocumentProps {
  kind: "Tax Invoice" | "Invoice" | "Quote";
  business: PdfBusiness;
  number: string;
  meta: { label: string; value: string }[];
  billTo: { name: string; lines: string[] };
  siteAddress?: string | null;
  title?: string | null;
  intro?: string | null;
  sections: PdfSection[];
  summary?: { label: string; value: string; bold?: boolean }[];
  paymentDetails?: string[] | null;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
  stamp?: string | null;
}

const BRAND = "#0284c7";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#18181b", lineHeight: 1.4 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  logo: { width: 120, maxHeight: 60, objectFit: "contain", marginBottom: 6 },
  businessName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BRAND },
  muted: { color: "#71717a" },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docNumber: { fontSize: 11, textAlign: "right", marginBottom: 6 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  metaLabel: { color: "#71717a", width: 70, textAlign: "right" },
  metaValue: { width: 90, textAlign: "right" },
  parties: { flexDirection: "row", gap: 24, marginBottom: 18 },
  partyBox: { flex: 1 },
  partyLabel: {
    fontSize: 8,
    color: "#71717a",
    textTransform: "uppercase",
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  paragraph: { marginBottom: 10 },
  sectionHeading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 2 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4d8",
    paddingBottom: 4,
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 4,
  },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 40, textAlign: "right" },
  colPrice: { width: 70, textAlign: "right" },
  colTotal: { width: 75, textAlign: "right" },
  totals: { marginTop: 8, alignSelf: "flex-end", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#18181b",
    paddingTop: 4,
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  box: { marginTop: 18, padding: 10, backgroundColor: "#f4f4f5", borderRadius: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#71717a",
    textAlign: "center",
  },
  stamp: {
    position: "absolute",
    top: 140,
    right: 60,
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#dc2626",
    opacity: 0.25,
    transform: "rotate(-15deg)",
  },
});

export function PdfDocument(props: PdfDocumentProps) {
  const { business } = props;
  return (
    <Document title={`${props.kind} ${props.number}`} author={business.businessName}>
      <Page size="A4" style={styles.page}>
        {props.stamp && <Text style={styles.stamp}>{props.stamp}</Text>}
        <View style={styles.header}>
          <View style={{ maxWidth: 260 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {business.logo && <Image src={business.logo} style={styles.logo} />}
            <Text style={styles.businessName}>{business.businessName}</Text>
            {business.tradingName && <Text>{business.tradingName}</Text>}
            {business.abn && <Text>ABN {business.abn}</Text>}
            {business.address && <Text style={styles.muted}>{business.address}</Text>}
            {business.phone && <Text style={styles.muted}>{business.phone}</Text>}
            {business.email && <Text style={styles.muted}>{business.email}</Text>}
            {business.website && <Text style={styles.muted}>{business.website}</Text>}
          </View>
          <View>
            <Text style={styles.docTitle}>{props.kind}</Text>
            <Text style={styles.docNumber}>{props.number}</Text>
            {props.meta.map((m) => (
              <View key={m.label} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{m.label}</Text>
                <Text style={styles.metaValue}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyBox}>
            <Text style={styles.partyLabel}>
              {props.kind === "Quote" ? "Prepared for" : "Bill to"}
            </Text>
            <Text style={styles.bold}>{props.billTo.name}</Text>
            {props.billTo.lines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
          {props.siteAddress && (
            <View style={styles.partyBox}>
              <Text style={styles.partyLabel}>Site address</Text>
              <Text>{props.siteAddress}</Text>
            </View>
          )}
        </View>

        {props.title && <Text style={styles.title}>{props.title}</Text>}
        {props.intro && <Text style={styles.paragraph}>{props.intro}</Text>}

        {props.sections.map((section, idx) => (
          <View key={idx} wrap={false} style={{ marginBottom: 6 }}>
            {section.heading && (
              <Text style={[styles.sectionHeading, section.highlight ? { color: BRAND } : {}]}>
                {section.heading}
                {section.highlight ? "  (selected)" : ""}
              </Text>
            )}
            {section.description && <Text style={styles.muted}>{section.description}</Text>}
            <View style={styles.tableHeader}>
              <Text style={styles.colDesc}>Description</Text>
              <Text style={styles.colQty}>Qty</Text>
              <Text style={styles.colPrice}>Unit (ex GST)</Text>
              <Text style={styles.colTotal}>Amount</Text>
            </View>
            {section.lines.map((line, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.colDesc}>
                  {line.description}
                  {business.gstRegistered && !line.taxable ? " (GST free)" : ""}
                </Text>
                <Text style={styles.colQty}>{line.quantity}</Text>
                <Text style={styles.colPrice}>{line.unitPrice}</Text>
                <Text style={styles.colTotal}>{line.total}</Text>
              </View>
            ))}
            <View style={styles.totals}>
              <View style={styles.totalRow}>
                <Text>Subtotal (ex GST)</Text>
                <Text>{section.subtotal}</Text>
              </View>
              {business.gstRegistered && (
                <View style={styles.totalRow}>
                  <Text>GST (10%)</Text>
                  <Text>{section.gst}</Text>
                </View>
              )}
              <View style={styles.grandTotal}>
                <Text>Total {business.gstRegistered ? "(inc GST)" : ""}</Text>
                <Text>{section.total}</Text>
              </View>
            </View>
          </View>
        ))}

        {props.summary && props.summary.length > 0 && (
          <View style={styles.totals}>
            {props.summary.map((s) => (
              <View key={s.label} style={s.bold ? styles.grandTotal : styles.totalRow}>
                <Text>{s.label}</Text>
                <Text>{s.value}</Text>
              </View>
            ))}
          </View>
        )}

        {props.paymentDetails && props.paymentDetails.length > 0 && (
          <View style={styles.box} wrap={false}>
            <Text style={[styles.bold, { marginBottom: 3 }]}>How to pay</Text>
            {props.paymentDetails.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
        )}
        {props.notes && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.partyLabel}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        )}
        {props.terms && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.partyLabel}>Terms and conditions</Text>
            <Text style={[styles.muted, { fontSize: 8 }]}>{props.terms}</Text>
          </View>
        )}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${props.footer ? `${props.footer}  ·  ` : ""}${props.kind} ${props.number}  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
