import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock, UserCircle2, ImagePlus, X, Mail, Phone, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import { fileToImageDataUrl, getInitials } from '../utils/imageUpload';

export function ProfilePage() {
  const { user, setCurrentUser } = useAuth();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [profilePhotoDataUrl, setProfilePhotoDataUrl] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setPhoneNumber(user?.phone_number || '');
    setAddress(user?.address || '');
    setProfilePhotoDataUrl(user?.profile_photo_data_url || '');
  }, [user?.phone_number, user?.address, user?.profile_photo_data_url]);

  const startEditingProfile = () => {
    setPhoneNumber(user?.phone_number || '');
    setAddress(user?.address || '');
    setProfilePhotoDataUrl(user?.profile_photo_data_url || '');
    setProfileError('');
    setProfileSuccess('');
    setIsEditingProfile(true);
  };

  const cancelEditingProfile = () => {
    setPhoneNumber(user?.phone_number || '');
    setAddress(user?.address || '');
    setProfilePhotoDataUrl(user?.profile_photo_data_url || '');
    setProfileError('');
    setIsEditingProfile(false);
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToImageDataUrl(file, 'Profile photo');
      setProfilePhotoDataUrl(dataUrl);
      setProfileError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read profile photo';
      setProfileError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    setProfileError('');
    setProfileSuccess('');

    const normalizedPhone = phoneNumber.trim();
    if (normalizedPhone && !/^[0-9+().\-\s]+$/.test(normalizedPhone)) {
      setProfileError('Invalid phone number');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await apiClient.authFetch('/users/me', {
        method: 'PUT',
        body: JSON.stringify({
          phone_number: normalizedPhone,
          address: address.trim(),
          profile_photo_data_url: profilePhotoDataUrl || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed updating profile');
      }
      setCurrentUser(payload);
      setProfileSuccess('Profile updated');
      setIsEditingProfile(false);
    } catch (err: any) {
      setProfileError(err?.message || 'Failed updating profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Fill all password fields');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await apiClient.authFetch('/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed updating password');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password updated');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed updating password');
    } finally {
      setSavingPassword(false);
    }
  };

  const editableInputClass = 'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500';
  const profileCompletion = [
    !!(user?.name || '').trim(),
    !!(user?.email || '').trim(),
    !!phoneNumber.trim(),
    !!address.trim(),
    !!profilePhotoDataUrl,
  ].filter(Boolean).length;
  const completionPercent = Math.round((profileCompletion / 5) * 100);
  const showCompletion = completionPercent < 100;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="relative h-40 bg-[linear-gradient(115deg,#1e293b_0%,#2563eb_45%,#67e8f9_100%)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.32),transparent_45%)]" />
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/20 to-transparent" />
        </div>

        <div className="relative px-5 pb-6 md:px-7">
          <div className="-mt-10 relative z-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex items-end gap-4">
              <div className="relative h-24 w-24 rounded-3xl bg-gradient-to-br from-fuchsia-500 via-blue-500 to-cyan-400 p-[3px] shadow-lg">
                <div className="h-full w-full rounded-[20px] border-2 border-white bg-slate-100 text-slate-700 flex items-center justify-center text-3xl font-semibold overflow-hidden">
                  {profilePhotoDataUrl ? (
                    <img src={profilePhotoDataUrl} alt={`${user?.name || 'User'} profile`} className="h-full w-full object-cover" />
                  ) : (
                    <span>{getInitials(user?.name, 'U')}</span>
                  )}
                </div>
                <span className={`absolute -right-1 -bottom-1 h-5 w-5 rounded-full border-2 border-white ${user?.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              </div>
              <div className="pb-1">
                <h1 className="text-2xl font-bold text-gray-900">{user?.name || 'User'}</h1>
                <p className="text-sm text-gray-600">{user?.email || '-'}</p>
              </div>
            </div>

            {!isEditingProfile ? (
              <button
                onClick={startEditingProfile}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
              >
                Edit Profile
              </button>
            ) : (
              <button
                onClick={cancelEditingProfile}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200"
              >
                Cancel Editing
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
              {user?.role || '-'}
            </span>
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
              {user?.is_active ? 'Active' : 'Inactive'}
            </span>
            {showCompletion && (
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                Profile completion {completionPercent}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCircle2 className="w-5 h-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-gray-900">Profile Details</h2>
          </div>
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            <span className={`px-3 py-1 text-xs font-medium rounded-md ${!isEditingProfile ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Overview</span>
            <span className={`px-3 py-1 text-xs font-medium rounded-md ${isEditingProfile ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Editing</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg font-semibold overflow-hidden">
              {profilePhotoDataUrl ? (
                <img src={profilePhotoDataUrl} alt={`${user?.name || 'User'} profile`} className="h-full w-full object-cover" />
              ) : (
                <span>{getInitials(user?.name, 'U')}</span>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Profile Photo</p>
              <p className="text-xs text-gray-500">PNG, JPG, WEBP, or GIF up to 2MB</p>
            </div>
          </div>

          {isEditingProfile && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <ImagePlus className="w-4 h-4" />
                {profilePhotoDataUrl ? 'Change Photo' : 'Upload Photo'}
                <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={handleProfilePhotoChange} />
              </label>
              {profilePhotoDataUrl && (
                <button
                  type="button"
                  onClick={() => setProfilePhotoDataUrl('')}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <X className="w-4 h-4" /> Remove
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1">
              <UserCircle2 className="w-3.5 h-3.5" /> Name
            </p>
            <p className="text-sm font-medium text-gray-900">{user?.name || '-'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> Email
            </p>
            <p className="text-sm font-medium text-gray-900">{user?.email || '-'}</p>
            <p className="text-xs text-gray-500 mt-1">Admin managed</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" /> Phone Number
            </p>
            {isEditingProfile ? (
              <input
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Enter phone number"
                className={editableInputClass}
              />
            ) : (
              <p className="text-sm font-medium text-gray-900">{phoneNumber || '-'}</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Address
            </p>
            {isEditingProfile ? (
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter address"
                className={editableInputClass}
              />
            ) : (
              <p className="text-sm font-medium text-gray-900">{address || '-'}</p>
            )}
          </div>
        </div>

        {profileError && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4" /> {profileError}
          </div>
        )}
        {profileSuccess && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4" /> {profileSuccess}
          </div>
        )}

        {isEditingProfile && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="inline-flex items-center justify-center px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
            <button
              onClick={cancelEditingProfile}
              type="button"
              className="inline-flex items-center justify-center px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-blue-700" />
          <h2 className="text-lg font-semibold text-gray-900">Security</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">Update your password regularly to keep your account secure.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={editableInputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={editableInputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={editableInputClass}
            />
          </div>
        </div>

        {passwordError && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4" /> {passwordError}
          </div>
        )}
        {passwordSuccess && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4" /> {passwordSuccess}
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={handleChangePassword}
            disabled={savingPassword}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {savingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
