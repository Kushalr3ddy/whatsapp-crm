import { redirect } from 'next/navigation';

/** There is nothing at the root yet, so it forwards to the only screen that exists. */
export default function Home() {
  redirect('/inbox');
}
