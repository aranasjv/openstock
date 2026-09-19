'use client';

import React, { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateSettings, testProvider } from '@/lib/actions/settings.actions';

interface SettingFieldProps {
    field: {
        key: string;
        label: string;
        description?: string;
        secret: boolean;
        runtimeEditable: boolean;
        type: 'text' | 'password' | 'number' | 'select';
        options?: string[];
        displayValue: string;
        isOverridden: boolean;
        fromEnv: boolean;
    };
    value: string;
    onChange: (key: string, value: string) => void;
}

const PROVIDER_TEST_TARGETS: Record<string, 'deepseek' | 'gemini' | 'minimax' | 'siray' | 'finnhub' | 'coingecko'> = {
    DEEPSEEK_API_KEY: 'deepseek',
    GEMINI_API_KEY: 'gemini',
    MINIMAX_API_KEY: 'minimax',
    SIRAY_API_KEY: 'siray',
    FINNHUB_API_KEY: 'finnhub',
    COINGECKO_API_KEY: 'coingecko',
};

export default function SettingField({ field, value, onChange }: SettingFieldProps) {
    const [pending, startTransition] = useTransition();
    const testTarget = PROVIDER_TEST_TARGETS[field.key];

    const handleTest = () => {
        if (!testTarget) return;
        startTransition(async () => {
            const result = await testProvider(testTarget);
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
        });
    };

    // Secrets are never sent back to the browser, so an untouched secret field shows a
    // masked placeholder instead of a value.
    const inputValue = field.secret ? value : value;
    const placeholder = field.secret
        ? field.displayValue || 'Not set'
        : field.displayValue || 'Not set';

    return (
        <div className="grid gap-1.5 py-3 border-b border-gray-800/60 last:border-0">
            <div className="flex items-center justify-between gap-3">
                <label htmlFor={field.key} className="text-sm font-medium text-gray-200">
                    {field.label}
                </label>
                <div className="flex items-center gap-2">
                    {field.isOverridden ? (
                        <span className="text-[10px] uppercase tracking-wider rounded bg-teal-900/40 px-1.5 py-0.5 text-teal-300">
                            saved
                        </span>
                    ) : field.fromEnv ? (
                        <span className="text-[10px] uppercase tracking-wider rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
                            from env
                        </span>
                    ) : null}
                    {testTarget ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={handleTest}
                            className="h-7 px-2 text-xs text-gray-400 hover:text-white hover:bg-white/10"
                        >
                            {pending ? 'Testing…' : 'Test'}
                        </Button>
                    ) : null}
                </div>
            </div>

            {field.description ? (
                <p className="text-xs text-gray-500">{field.description}</p>
            ) : null}

            {field.type === 'select' && field.options ? (
                <select
                    id={field.key}
                    value={inputValue}
                    disabled={!field.runtimeEditable}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    className="h-9 rounded-md border border-gray-800 bg-[#1C1C1F] px-3 text-sm text-white disabled:opacity-50"
                >
                    {field.options.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    id={field.key}
                    type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
                    value={inputValue}
                    disabled={!field.runtimeEditable}
                    placeholder={placeholder}
                    autoComplete="off"
                    onChange={(e) => onChange(field.key, e.target.value)}
                    className="h-9 rounded-md border border-gray-800 bg-[#1C1C1F] px-3 font-mono text-sm text-white placeholder:text-gray-600 disabled:opacity-50"
                />
            )}

            {field.secret && field.displayValue && field.runtimeEditable ? (
                <p className="text-[10px] text-gray-600">
                    Current: <span className="font-mono">{field.displayValue}</span> — type a new
                    value to replace it.
                </p>
            ) : null}
        </div>
    );
}
