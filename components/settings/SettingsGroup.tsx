'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import SettingField from './SettingField';
import { updateSettings } from '@/lib/actions/settings.actions';

export interface SettingsFieldView {
    key: string;
    label: string;
    description?: string;
    group: string;
    secret: boolean;
    runtimeEditable: boolean;
    type: 'text' | 'password' | 'number' | 'select';
    options?: string[];
    displayValue: string;
    isOverridden: boolean;
    fromEnv: boolean;
}

interface SettingsGroupProps {
    title: string;
    fields: SettingsFieldView[];
}

export default function SettingsGroup({ title, fields }: SettingsGroupProps) {
    const [pending, startTransition] = useTransition();
    const [edits, setEdits] = useState<Record<string, string>>({});

    const handleChange = (key: string, value: string) => {
        setEdits((prev) => ({ ...prev, [key]: value }));
    };

    /**
     * Only send what the user actually touched. Secrets are never sent to the browser, so
     * a blank secret field means "leave unchanged" rather than "clear it".
     */
    const dirty = useMemo(() => {
        const payload: Record<string, string> = {};
        for (const [key, value] of Object.entries(edits)) {
            const field = fields.find((f) => f.key === key);
            if (!field || !field.runtimeEditable) continue;
            if (field.secret) {
                if (value !== '') payload[key] = value;
            } else if (value !== field.displayValue) {
                payload[key] = value;
            }
        }
        return payload;
    }, [edits, fields]);

    const dirtyCount = Object.keys(dirty).length;

    const handleSave = () => {
        if (dirtyCount === 0) return;
        startTransition(async () => {
            const result = await updateSettings(dirty);
            if (result.success) {
                setEdits({});
                toast.success(`Saved ${result.saved?.length ?? 0} setting(s).`);
                if (result.rejected?.length) {
                    toast.warning(`Ignored: ${result.rejected.join(', ')}`);
                }
            } else {
                toast.error(result.error ?? 'Could not save settings.');
            }
        });
    };

    const handleReset = () => {
        setEdits({});
    };

    return (
        <section className="rounded-xl border border-gray-800 bg-gray-900/30 p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">{title}</h2>
                <div className="flex items-center gap-2">
                    {dirtyCount > 0 ? (
                        <span className="text-xs text-gray-400">{dirtyCount} unsaved</span>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={dirtyCount === 0 || pending}
                        onClick={handleReset}
                        className="h-8 px-2 text-gray-400 hover:bg-white/10 hover:text-white"
                    >
                        Reset
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={dirtyCount === 0 || pending}
                        onClick={handleSave}
                        className="h-8 bg-teal-600 px-3 text-white hover:bg-teal-500"
                    >
                        {pending ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </div>

            {fields.map((field) => (
                <SettingField
                    key={field.key}
                    field={field}
                    value={edits[field.key] ?? (field.secret ? '' : field.displayValue)}
                    onChange={handleChange}
                />
            ))}
        </section>
    );
}
