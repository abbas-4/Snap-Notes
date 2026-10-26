import { Link } from 'react-router';
import { primaryButton } from './styles';

export default function NotFoundPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-gray-700">There is nothing at this address.</p>
      <Link to="/" className={`${primaryButton} mt-4`}>
        Go to the home page
      </Link>
    </div>
  );
}
