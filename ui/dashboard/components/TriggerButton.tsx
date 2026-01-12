import React, { useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface TriggerButtonProps {
  label: string;
  activeLabel: string;
  onClick: () => Promise<{ success: boolean; message?: string }>;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
  icon?: React.ReactNode;
  requireConfirm?: boolean;
  confirmMessage?: string;
}

const variantClasses = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  secondary: 'bg-gray-600 hover:bg-gray-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
};

const TriggerButton: React.FC<TriggerButtonProps> = ({
  label,
  activeLabel,
  onClick,
  variant = 'primary',
  disabled = false,
  icon,
  requireConfirm = false,
  confirmMessage = 'Are you sure you want to proceed?',
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null);

  const handleClick = async () => {
    if (requireConfirm && !window.confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await onClick();
      setResult(response);
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Operation failed',
      });
    } finally {
      setLoading(false);
      // Clear result after 5 seconds
      setTimeout(() => setResult(null), 5000);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={disabled || loading}
        className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]}`}
      >
        {loading ? (
          <>
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
            {activeLabel}
          </>
        ) : (
          <>
            {icon}
            {label}
          </>
        )}
      </button>

      {result && (
        <div
          className={`flex items-center gap-2 text-sm p-2 rounded ${
            result.success
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {result.success ? (
            <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
          ) : (
            <XCircleIcon className="h-4 w-4 flex-shrink-0" />
          )}
          <span>{result.message || (result.success ? 'Success!' : 'Failed')}</span>
        </div>
      )}
    </div>
  );
};

export default TriggerButton;
