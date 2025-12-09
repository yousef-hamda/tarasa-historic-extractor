import { NextPageContext } from 'next';
import Link from 'next/link';

interface ErrorProps {
  statusCode?: number;
}

function Error({ statusCode }: ErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900">{statusCode || 'Error'}</h1>
        <p className="mt-4 text-xl text-gray-600">
          {statusCode === 404
            ? 'This page could not be found.'
            : 'An error occurred on the server.'}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
