import {
  generateProjectOgImage,
  projectOgContentType,
  projectOgSize,
} from "@/lib/project-og";

type Props = {
  params: Promise<{ accession: string }>;
};

export const size = projectOgSize;
export const contentType = projectOgContentType;

function detectProjectType(
  accession: string,
): "geo" | "sra" | "ena" | "arrayexpress" | "gsa" | "ddbj" | "gea" {
  const upper = accession.toUpperCase();

  if (/^E-GEAD-\d+$/.test(upper)) {
    return "gea";
  }

  if (upper.startsWith("E-")) {
    return "arrayexpress";
  }

  if (upper.startsWith("G")) {
    return "geo";
  }

  if (upper.startsWith("ERP")) {
    return "ena";
  }

  if (upper.startsWith("DRP") || upper.startsWith("PRJDB")) {
    return "ddbj";
  }

  if (
    upper.startsWith("CRA") ||
    upper.startsWith("CRX") ||
    upper.startsWith("CRR") ||
    upper.startsWith("HRA") ||
    upper.startsWith("HRX") ||
    upper.startsWith("HRR") ||
    upper.startsWith("PRJCA") ||
    upper.startsWith("SAMC")
  ) {
    return "gsa";
  }

  return "sra";
}

export default async function OpengraphImage({ params }: Props) {
  const { accession } = await params;
  const projectType = detectProjectType(accession);
  return generateProjectOgImage(accession, projectType);
}
