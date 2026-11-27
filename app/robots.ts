import type {MetadataRoute} from 'next';

/** Public research data: crawlers and AI fetchers may read everything. */
export default function robots():MetadataRoute.Robots{
 return {rules:[{userAgent:'*',allow:'/'}]};
}
