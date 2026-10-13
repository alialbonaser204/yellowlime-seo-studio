import { useState } from 'react';
import { Plus, Search, Trash2, Users, FileEdit, Check, RefreshCw, TriangleAlert, X, Image as ImageIcon, CheckCircle2, UserCircle, Sparkles, BookOpen } from 'lucide-react';
import { 
  useListYellowlimers, 
  useCreateYellowlimer, 
  useUpdateYellowlimer, 
  useRemoveYellowlimer,
  getListYellowlimersQueryKey
} from '@yellowlime/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useImageUpload } from '../hooks/use-image-upload';
import type { Yellowlimer, YellowlimerInputAvatarType, YellowlimerUpdateAvatarType } from '@yellowlime/api-client-react';
import { useStudio } from '../App';

export const ICONS = ['UserCircle', 'Users', 'Sparkles', 'BookOpen'] as const;

const failedAvatarImages = new Set<string>();

function YellowlimerAvatar({ type, value, name }: { type: string, value: string, name: string }) {
  const [imageFailed, setImageFailed] = useState(() => failedAvatarImages.has(value));
  if (type === 'image' && !imageFailed) {
    return <img src={`/api/storage${value}`} alt={name} onError={() => { failedAvatarImages.add(value); setImageFailed(true); }} className="avatar-image" style={{ width: 35, height: 35, borderRadius: 9, objectFit: 'cover' }} />;
  }
  return <div className="partner-symbol">{value === 'Sparkles' ? <Sparkles size={16} /> : value === 'BookOpen' ? <BookOpen size={16} /> : value === 'Users' ? <Users size={16} /> : <UserCircle size={16} />}</div>;
}

export function YellowlimerModal({ 
  onClose, 
  yellowlimer 
}: { 
  onClose: () => void, 
  yellowlimer?: Yellowlimer 
}) {
  const { addToast } = useStudio();
  const queryClient = useQueryClient();
  const createMutation = useCreateYellowlimer();
  const updateMutation = useUpdateYellowlimer();
  const { upload, isUploading, error: uploadError } = useImageUpload();
  
  const [form, setForm] = useState({ 
    name: yellowlimer?.name || '', 
    avatarType: yellowlimer?.avatarType || 'icon',
    avatarValue: yellowlimer?.avatarValue || ICONS[0] 
  });
  
  const [errors, setErrors] = useState({ name: '', image: '' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const newErrors = { name: '', image: '' };
    let isValid = true;
    
    if (!form.name.trim()) { newErrors.name = 'Naam is verplicht.'; isValid = false; }
    
    setErrors(newErrors);
    if (!isValid) return;

    const payload = {
      name: form.name,
      avatarType: form.avatarType as YellowlimerInputAvatarType,
      avatarValue: form.avatarValue
    };

    if (yellowlimer) {
      updateMutation.mutate({ id: yellowlimer.id, data: { ...payload, active: yellowlimer.active, avatarType: payload.avatarType as YellowlimerUpdateAvatarType } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListYellowlimersQueryKey() });
          addToast('Yellowlimer is bijgewerkt.');
          onClose();
        },
        onError: () => addToast('Fout bij bijwerken.')
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListYellowlimersQueryKey() });
          addToast('Yellowlimer is succesvol toegevoegd.');
          onClose();
        },
        onError: () => addToast('Fout bij toevoegen.')
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectPath = await upload(file);
    if (objectPath) {
      setForm(prev => ({ ...prev, avatarType: 'image', avatarValue: objectPath }));
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending || isUploading;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form className="modal" onSubmit={submit} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Yellowlimers</div>
            <h2>{yellowlimer ? 'Yellowlimer bewerken' : 'Yellowlimer toevoegen'}</h2>
            <p>Teamlid voor beoordelingen van artikelen.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-yellowlimer-modal"><X /></button>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="field full">
            <label htmlFor="name">Naam medewerker <span style={{ color: 'hsl(var(--destructive))' }}>verplicht</span></label>
            <input id="name" className="input" value={form.name} placeholder="Bijv. naam medewerker" onChange={(event) => setForm(current => ({ ...current, name: event.target.value }))} data-testid="input-yellowlimer-name" />
            {errors.name && <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }} data-testid="error-yellowlimer-name">{errors.name}</span>}
          </div>
          
          <div className="field full">
            <label>Icoon of profielfoto</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              {ICONS.map(icon => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, avatarType: 'icon', avatarValue: icon }))}
                  className="icon-button"
                  style={{ width: 45, height: 45, borderColor: form.avatarType === 'icon' && form.avatarValue === icon ? 'hsl(var(--primary))' : '' }}
                >
                  {icon === 'Sparkles' ? <Sparkles size={20} /> : icon === 'BookOpen' ? <BookOpen size={20} /> : icon === 'Users' ? <Users size={20} /> : <UserCircle size={20} />}
                </button>
              ))}
              
              {form.avatarType === 'image' && form.avatarValue && (
                <div style={{ width: 45, height: 45, borderRadius: 6, overflow: 'hidden', border: '1px solid hsl(var(--primary))' }}>
                  <img src={`/api/storage${form.avatarValue}`} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
            </div>

            <label htmlFor="avatar-upload" className="button button-ghost" style={{ justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
              <ImageIcon size={15} /> Upload afbeelding (max 2MB)
              <input 
                id="avatar-upload"
                type="file" 
                accept="image/png, image/jpeg, image/webp" 
                onChange={handleFileChange}
                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', top: 0, left: 0 }} 
                disabled={isUploading}
              />
            </label>
            
            {uploadError && (
              <span className="text-destructive text-xs" style={{ color: 'hsl(var(--destructive))', fontSize: '11px' }}>{uploadError}</span>
            )}
          </div>
        </div>
        
        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-yellowlimer">Annuleren</button>
          <button type="submit" className="button button-primary" data-testid="button-save-yellowlimer" disabled={pending}>
            {pending ? 'Bezig met opslaan...' : <><Check size={15} /> Opslaan</>}
          </button>
        </div>
      </form>
    </div>
  );
}

export function YellowlimersPage() {
  const { data: yellowlimers = [], isLoading, isError } = useListYellowlimers();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  
  const queryClient = useQueryClient();
  const removeMutation = useRemoveYellowlimer();
  const { addToast } = useStudio();
  
  const filtered = yellowlimers.filter(y => y.name.toLowerCase().includes(search.toLowerCase()));

  const handleRemove = (id: number) => {
    if (window.confirm('Weet je zeker dat je deze Yellowlimer wilt verwijderen/deactiveren?')) {
      removeMutation.mutate({ id }, {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListYellowlimersQueryKey() });
          if (result.deleted) {
            addToast('Yellowlimer volledig verwijderd.');
          } else {
            addToast('Yellowlimer op non-actief gezet omdat deze gekoppeld is aan bestaande gegevens.');
          }
        },
        onError: () => addToast('Fout bij verwijderen.')
      });
    }
  };

  return (
    <>
      <div className="page-header fade-up">
        <div>
          <div className="eyebrow">Team</div>
          <h1>Beheer Yellowlimers</h1>
          <p>Beheer de mensen die eindverantwoordelijk zijn voor goedkeuringen.</p>
        </div>
        <button className="button button-primary" onClick={() => setAdding(true)} data-testid="button-add-yellowlimer">
          <Plus size={16} /> Yellowlimer toevoegen
        </button>
      </div>
      
      <div className="card" style={{ padding: '11px 13px', marginBottom: 17, display: 'flex', alignItems: 'center', gap: 9, maxWidth: 420 }}>
        <Search size={15} color="hsl(var(--muted-foreground))" />
        <input className="input" style={{ border: 0, padding: 0, background: 'transparent' }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek op naam" data-testid="input-search-yellowlimers" />
      </div>
      
      {isLoading ? (
        <div className="empty-state card">
          <RefreshCw size={28} className="animate-spin" />
          <h3>Yellowlimers laden...</h3>
        </div>
      ) : isError ? (
        <div className="empty-state card">
          <TriangleAlert size={28} color="hsl(var(--destructive))" />
          <h3>Fout bij laden</h3>
        </div>
      ) : filtered.length ? (
        <div className="partner-grid">
          {filtered.map((yellowlimer) => (
            <article className="card partner-card" key={yellowlimer.id} data-testid={`card-yellowlimer-${yellowlimer.id}`} style={{ opacity: yellowlimer.active ? 1 : 0.6 }}>
              <div className="partner-top">
                <YellowlimerAvatar type={yellowlimer.avatarType} value={yellowlimer.avatarValue} name={yellowlimer.name} />
                {!yellowlimer.active && <span className="status-pill status-draft">Inactief</span>}
              </div>
              <h3>{yellowlimer.name}</h3>
              
              <div className="card-foot" style={{ marginTop: 'auto', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="icon-button" onClick={() => setEditingId(yellowlimer.id)} data-testid={`button-edit-yellowlimer-${yellowlimer.id}`} title="Bewerken"><FileEdit size={14} /></button>
                <button type="button" className="icon-button" style={{ color: 'hsl(var(--destructive))' }} onClick={() => handleRemove(yellowlimer.id)} data-testid={`button-remove-yellowlimer-${yellowlimer.id}`} disabled={removeMutation.isPending} title="Verwijderen"><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state card">
          <Users size={28} />
          <h3>Geen Yellowlimers gevonden</h3>
          <p>Voeg medewerkers toe zodat ze kunnen worden geselecteerd als controleurs.</p>
          <button className="button button-primary" onClick={() => setAdding(true)}>Toevoegen</button>
        </div>
      )}
      
      {adding && <YellowlimerModal onClose={() => setAdding(false)} />}
      {editingId !== null && <YellowlimerModal yellowlimer={yellowlimers.find(y => y.id === editingId)} onClose={() => setEditingId(null)} />}
    </>
  );
}
