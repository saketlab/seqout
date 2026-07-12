import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Accessions are uppercase in every namespace we serve (GSE, SRP, SRR, PRJNA,
// E-MTAB-*, CRA/HRA), so lowercase URLs are duplicates, not distinct pages.
const ACCESSION_ROUTE = /^\/([pser])\/([^/]+)$/;
const ACCESSION_SHAPE = /^[A-Z0-9][A-Z0-9._-]*$/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const accessionMatch = pathname.match(ACCESSION_ROUTE);
  if (accessionMatch) {
    const [, kind, raw] = accessionMatch;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return NextResponse.next();
    }
    const upper = decoded.toUpperCase();
    if (decoded !== upper && ACCESSION_SHAPE.test(upper)) {
      const url = request.nextUrl.clone();
      url.pathname = `/${kind}/${encodeURIComponent(upper)}`;
      return NextResponse.redirect(url, 301);
    }
    return NextResponse.next();
  }

  // Backward compatibility: redirect old URLs to new format
  // /project/geo/{accession} -> /p/{accession}
  if (pathname.startsWith("/project/geo/")) {
    const accession = pathname.slice(13); // Remove '/project/geo/'
    if (accession) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${accession}`;
      return NextResponse.redirect(url, 301); // Permanent redirect
    }
  }

  // Backward compatibility: redirect old URLs to new format
  // /project/sra/{accession} -> /p/{accession}
  if (pathname.startsWith("/project/sra/")) {
    const accession = pathname.slice(13); // Remove '/project/sra/'
    if (accession) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${accession}`;
      return NextResponse.redirect(url, 301); // Permanent redirect
    }
  }

  // Also handle the shorter variants for completeness
  // /project/g/{accession} -> /p/{accession}
  if (pathname.startsWith("/project/g/")) {
    const accession = pathname.slice(11); // Remove '/project/g/'
    if (accession) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${accession}`;
      return NextResponse.redirect(url, 301);
    }
  }

  // /project/s/{accession} -> /p/{accession}
  if (pathname.startsWith("/project/s/")) {
    const accession = pathname.slice(11); // Remove '/project/s/'
    if (accession) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${accession}`;
      return NextResponse.redirect(url, 301);
    }
  }

  // /project/gse/{accession} -> /p/{accession} (alternate GEO format)
  if (pathname.startsWith("/project/gse/")) {
    const accession = pathname.slice(13); // Remove '/project/gse/'
    if (accession) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${accession}`;
      return NextResponse.redirect(url, 301);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/p/:path*",
    "/s/:path*",
    "/e/:path*",
    "/r/:path*",
    "/project/geo/:path*",
    "/project/sra/:path*",
    "/project/g/:path*",
    "/project/s/:path*",
    "/project/gse/:path*",
  ],
};
