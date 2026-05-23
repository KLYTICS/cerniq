import { redirect } from 'next/navigation';

export default function StripeModeRedirect() {
  redirect('/everywhere');
}
