package io.github.helloqun54321.naiatelier;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import com.getcapacitor.JSObject;
import java.io.*;
import java.util.HashSet;
import java.util.Set;

/** 公共导出目录只使用系统授予的树权限，不改变私有资料位置。 */
final class AtelierExports {
    static SharedPreferences preferences(Context context) { return context.getSharedPreferences("atelier-exports", Context.MODE_PRIVATE); }
    static String mode(Context context) { return preferences(context).getString("mode", "system"); }
    static Uri tree(Context context) {
        String value=preferences(context).getString("directory", "");
        return value.isEmpty()?null:Uri.parse(value);
    }
    static JSObject status(Context context) {
        SharedPreferences prefs=preferences(context);JSObject result=new JSObject();
        result.put("mode",mode(context));result.put("directory",prefs.getString("name",""));
        result.put("canPickDirectory",true);result.put("canAsk",true);result.put("platform","android");return result;
    }
    static JSObject setMode(Context context,String mode) throws IOException {
        if(!mode.equals("system")&&!mode.equals("directory")&&!mode.equals("ask"))throw new IOException("导出模式无效");
        if(mode.equals("directory")&&tree(context)==null)throw new IOException("请先选择导出目录");
        if(!preferences(context).edit().putString("mode",mode).commit())throw new IOException("导出偏好保存失败");return status(context);
    }
    static JSObject remember(Context context,Uri uri,int flags) throws Exception {
        if(uri==null||!DocumentsContract.isTreeUri(uri)||(flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0)throw new IOException("系统未授予导出目录写入权限");
        Uri previous=tree(context);int grants=flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        context.getContentResolver().takePersistableUriPermission(uri,grants);
        String name=DocumentsContract.getTreeDocumentId(uri);
        Uri root=DocumentsContract.buildDocumentUriUsingTree(uri,name);
        try(Cursor cursor=context.getContentResolver().query(root,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);
        }
        if(!preferences(context).edit().putString("directory",uri.toString()).putString("name",name).putString("mode","directory").commit())throw new IOException("导出偏好保存失败");
        if(previous!=null&&!previous.equals(uri))release(context,previous);return status(context);
    }
    private static void release(Context context,Uri uri) {
        try {context.getContentResolver().releasePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException ignored){}
    }
    static JSObject clear(Context context) throws IOException {
        Uri previous=tree(context);if(!preferences(context).edit().clear().commit())throw new IOException("导出偏好保存失败");
        if(previous!=null)release(context,previous);return status(context);
    }
    static String availableName(String filename,Set<String> existing) throws IOException {
        if(filename==null||filename.isEmpty()||filename.contains("/")||filename.contains("\\")||filename.indexOf('\0')>=0)throw new IOException("导出文件名无效");
        int dot=filename.lastIndexOf('.');String stem=dot>0?filename.substring(0,dot):filename,extension=dot>0?filename.substring(dot):"";
        for(int index=0;index<10000;index++){String name=index==0?filename:stem+" ("+index+")"+extension;if(!existing.contains(name))return name;}
        throw new IOException("导出目录中的同名文件过多");
    }
    static JSObject writeToTree(Context context,File source,String filename,String mime) throws Exception {
        Uri tree=tree(context);if(tree==null)throw new IOException("请先选择导出目录");
        boolean writable=false;for(UriPermission permission:context.getContentResolver().getPersistedUriPermissions())if(permission.getUri().equals(tree)&&permission.isWritePermission())writable=true;
        if(!writable)throw new IOException("导出目录权限已失效，请重新选择目录");
        String id=DocumentsContract.getTreeDocumentId(tree);Set<String> names=new HashSet<>();
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,id);
        try(Cursor cursor=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if(cursor==null)throw new IOException("导出目录无法读取，请重新选择");while(cursor.moveToNext())names.add(cursor.getString(0));
        }
        String name=availableName(filename,names);Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,id);
        Uri output=DocumentsContract.createDocument(context.getContentResolver(),parent,mime,name);
        if(output==null)throw new IOException("无法在导出目录创建文件");
        try {write(context,source,output);}catch(Exception error){try{DocumentsContract.deleteDocument(context.getContentResolver(),output);}catch(Exception ignored){}throw error;}
        JSObject result=new JSObject();result.put("saved",true);result.put("cancelled",false);result.put("path",output.toString());result.put("filename",name);return result;
    }
    static void write(Context context,File source,Uri uri) throws IOException {
        if(uri==null)throw new IOException("系统没有返回保存位置");
        try(InputStream in=new FileInputStream(source);OutputStream out=context.getContentResolver().openOutputStream(uri,"w")) {
            if(out==null)throw new IOException("导出文件写入失败");AtelierBackup.copy(in,out);out.flush();
        }
    }
}
