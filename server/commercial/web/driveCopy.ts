export const driveCopy = (id: string) => ({
  es: ['Guardar SRT en Drive','Guardar MP4 en Drive','Guardando en Drive','Guardado en Drive','Cancelar','No se pudo guardar en Drive. Revisa el permiso, el espacio y la conexión.'],
  en: ['Save SRT to Drive','Save MP4 to Drive','Saving to Drive','Saved to Drive','Cancel','Could not save to Drive. Check permission, storage and connection.'],
  ar: ['حفظ SRT في Drive','حفظ MP4 في Drive','جارٍ الحفظ في Drive','تم الحفظ في Drive','إلغاء','تعذر الحفظ في Drive. تحقق من الإذن والمساحة والاتصال.'],
  pt: ['Salvar SRT no Drive','Salvar MP4 no Drive','Salvando no Drive','Salvo no Drive','Cancelar','Não foi possível salvar no Drive. Verifique a permissão, o espaço e a conexão.'],
  fr: ['Enregistrer le SRT dans Drive','Enregistrer le MP4 dans Drive','Enregistrement dans Drive','Enregistré dans Drive','Annuler','Échec de l’enregistrement dans Drive. Vérifiez les autorisations, l’espace et la connexion.'],
  de: ['SRT in Drive speichern','MP4 in Drive speichern','Wird in Drive gespeichert','In Drive gespeichert','Abbrechen','Speichern in Drive fehlgeschlagen. Berechtigung, Speicherplatz und Verbindung prüfen.'],
  ja: ['SRTをDriveに保存','MP4をDriveに保存','Driveに保存中','Driveに保存しました','キャンセル','Driveに保存できません。権限、空き容量、接続を確認してください。'],
  ko: ['SRT를 Drive에 저장','MP4를 Drive에 저장','Drive에 저장 중','Drive에 저장됨','취소','Drive에 저장하지 못했습니다. 권한, 저장 공간 및 연결을 확인하세요.'],
  cmn: ['将SRT保存到Drive','将MP4保存到Drive','正在保存到Drive','已保存到Drive','取消','无法保存到Drive。请检查权限、存储空间和连接。'],
  vi: ['Lưu SRT vào Drive','Lưu MP4 vào Drive','Đang lưu vào Drive','Đã lưu vào Drive','Hủy','Không thể lưu vào Drive. Hãy kiểm tra quyền, dung lượng và kết nối.'],
}[id] ?? ['Save SRT to Drive','Save MP4 to Drive','Saving to Drive','Saved to Drive','Cancel','Could not save to Drive. Check permission, storage and connection.']);
